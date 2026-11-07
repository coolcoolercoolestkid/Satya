/**
 * The canonical Aletheia date representation: a `uint32` in YYYYMMDD form, always a UTC
 * calendar date. See `docs/date-format.md` for why, and for the boundary tables these
 * functions are tested against.
 *
 * This module is the single source of truth. Extraction, normalization, issuer signing,
 * circuit inputs and the Solidity `DateLib` all agree with it, or one of them is wrong.
 */

import { MAX_DATE_YYYYMMDD, MIN_DATE_YYYYMMDD } from "./constants.ts";

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Days in `month` (1-12) of `year`, proleptic Gregorian. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new RangeError(`month out of range: ${month}`);
  }
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Split a YYYYMMDD integer into its parts without validating them. */
export function splitYyyymmdd(value: number): CalendarDate {
  return {
    year: Math.trunc(value / 10000),
    month: Math.trunc(value / 100) % 100,
    day: value % 100,
  };
}

/**
 * True when `value` is a real UTC calendar date inside the supported range. Rejects
 * sparse encodings such as 20261232 that are representable but not dates.
 */
export function isValidYyyymmdd(value: number): boolean {
  if (!Number.isInteger(value)) return false;
  if (value < MIN_DATE_YYYYMMDD || value > MAX_DATE_YYYYMMDD) return false;
  const { year, month, day } = splitYyyymmdd(value);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function assertValidYyyymmdd(value: number, label: string): void {
  if (!isValidYyyymmdd(value)) {
    throw new RangeError(`${label} is not a valid YYYYMMDD date in range: ${value}`);
  }
}

export function toYyyymmdd(date: CalendarDate): number {
  const value = date.year * 10000 + date.month * 100 + date.day;
  assertValidYyyymmdd(value, "date");
  return value;
}

export function parseYyyymmdd(value: number): CalendarDate {
  assertValidYyyymmdd(value, "date");
  return splitYyyymmdd(value);
}

/** The UTC calendar date of a `Date`, as YYYYMMDD. Time of day is discarded. */
export function dateToYyyymmdd(date: Date): number {
  return toYyyymmdd({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/** UTC midnight of a YYYYMMDD date. */
export function yyyymmddToDate(value: number): Date {
  const { year, month, day } = parseYyyymmdd(value);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Today's UTC date as YYYYMMDD. */
export function todayUtcYyyymmdd(now: Date = new Date()): number {
  return dateToYyyymmdd(now);
}

/** Largest supported `minimumAge`, matched by the on-chain parameter range check. */
export const MAX_MINIMUM_AGE = 120;

/**
 * The latest date of birth that still satisfies `age >= minimumAge` on `currentDate`.
 *
 * Subtracting `minimumAge * 10000` decrements only the year field, so the result is
 * exact on the birthday itself with no leap-year reasoning. This is the same
 * computation the age circuit performs.
 */
export function ageThresholdYyyymmdd(currentDate: number, minimumAge: number): number {
  assertValidYyyymmdd(currentDate, "currentDate");
  if (!Number.isInteger(minimumAge) || minimumAge < 0 || minimumAge > MAX_MINIMUM_AGE) {
    throw new RangeError(`minimumAge out of range: ${minimumAge}`);
  }
  const threshold = currentDate - minimumAge * 10000;
  if (threshold < MIN_DATE_YYYYMMDD) {
    throw new RangeError(
      `age threshold falls below the supported date range: ${threshold}`,
    );
  }
  return threshold;
}

/** Whether a holder born on `dateOfBirth` is at least `minimumAge` on `currentDate`. */
export function satisfiesMinimumAge(
  dateOfBirth: number,
  currentDate: number,
  minimumAge: number,
): boolean {
  assertValidYyyymmdd(dateOfBirth, "dateOfBirth");
  return dateOfBirth <= ageThresholdYyyymmdd(currentDate, minimumAge);
}

/** Whether a credential expiring on `expiryDate` is still valid on `currentDate`. */
export function isUnexpired(expiryDate: number, currentDate: number): boolean {
  assertValidYyyymmdd(expiryDate, "expiryDate");
  assertValidYyyymmdd(currentDate, "currentDate");
  return expiryDate >= currentDate;
}

/** Completed years between two dates, for display only. Never used in a claim. */
export function completedYears(dateOfBirth: number, currentDate: number): number {
  assertValidYyyymmdd(dateOfBirth, "dateOfBirth");
  assertValidYyyymmdd(currentDate, "currentDate");
  return Math.trunc((currentDate - dateOfBirth) / 10000);
}

/**
 * The oldest a living passport holder is assumed to be. A birth date more than this many
 * years before `currentDate` is treated as not belonging to a current holder, which is
 * what lets century inference rule out the 19xx reading for a recent two-digit year.
 * Sized above the verified human maximum (~122) so a real centenarian's document is never
 * silently rejected — it is reported *ambiguous* instead.
 */
export const MAX_DOCUMENT_HOLDER_AGE = 120;

/**
 * The outcome of inferring the century of an MRZ two-digit year for a date of birth.
 * `ambiguous` means both the 19xx and 20xx readings are plausible living holders and the
 * caller must ask rather than guess; `invalid` means neither reading is a real in-range
 * date that is not in the future. See `docs/passport-extraction.md`.
 */
export type BirthCenturyInference =
  | { kind: "resolved"; value: number }
  | { kind: "ambiguous" }
  | { kind: "invalid" };

/** A raw year/month/day, century not yet known, as read from six MRZ digits. */
function candidateYyyymmdd(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

/**
 * Expand an MRZ expiry `YYMMDD` to canonical YYYYMMDD. Expiry is always `20YY`: a passport
 * in circulation cannot have expired in the 1900s (`docs/passport-extraction.md`). Throws
 * `RangeError` if the digits are not a real UTC date in range — an expiry has no century
 * ambiguity, so an unparseable one is simply invalid.
 */
export function expandExpiryYymmdd(twoDigitYear: number, month: number, day: number): number {
  return toYyyymmdd({ year: 2000 + twoDigitYear, month, day });
}

/**
 * Infer the century of an MRZ date-of-birth `YYMMDD` against `currentDate`.
 *
 * The rule (fixed in `docs/passport-extraction.md`, not left to the parser, because a
 * wrong century silently shifts an age claim by 100 years): a reading is a possible birth
 * date only if it is a real calendar date, is not in the future, and is no more than
 * {@link MAX_DOCUMENT_HOLDER_AGE} years ago. When exactly one of the `19YY` / `20YY`
 * readings qualifies it is chosen; when both qualify — the holder is at or over 100 and
 * the two readings are a century apart — the result is `ambiguous` and must never be
 * guessed; when neither qualifies it is `invalid`.
 *
 * Both readings are evaluated independently, so a Feb-29 date valid in one century's leap
 * year and not the other resolves correctly.
 */
export function inferBirthYymmdd(
  twoDigitYear: number,
  month: number,
  day: number,
  currentDate: number,
): BirthCenturyInference {
  assertValidYyyymmdd(currentDate, "currentDate");
  const nineteen = candidateYyyymmdd(1900 + twoDigitYear, month, day);
  const twenty = candidateYyyymmdd(2000 + twoDigitYear, month, day);
  const plausible = (value: number): boolean =>
    isValidYyyymmdd(value) &&
    value <= currentDate &&
    completedYears(value, currentDate) <= MAX_DOCUMENT_HOLDER_AGE;
  const nineteenOk = plausible(nineteen);
  const twentyOk = plausible(twenty);
  if (nineteenOk && twentyOk) return { kind: "ambiguous" };
  if (twentyOk) return { kind: "resolved", value: twenty };
  if (nineteenOk) return { kind: "resolved", value: nineteen };
  return { kind: "invalid" };
}
