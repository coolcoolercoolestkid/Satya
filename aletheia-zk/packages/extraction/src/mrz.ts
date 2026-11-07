/**
 * TD3 passport MRZ → candidate credential fields.
 *
 * The one sentence that governs this module (`docs/passport-extraction.md`): **extraction
 * produces untrusted candidate fields, never evidence.** Nothing here is signed by anyone.
 * A user reviews and corrects every field before the mock issuer attests it; this step
 * saves typing, it is not an authority.
 *
 * The parser reads only the machine-readable zone — fixed-width, single-font, with check
 * digits — not the visual inspection zone, and reads only line 2, which carries every
 * field the schema needs. The issuing state on line 1 is deliberately dropped
 * (`docs/passport-extraction.md`, field mapping).
 *
 * Outcomes that are a normal part of reading a document are values, not thrown errors: a
 * failing check digit, a genuinely ambiguous century, and an unsupported nationality are
 * each reported as an issue naming the field, so the review step can tell the holder
 * exactly what to re-scan or confirm. The parser only throws if asked to work on something
 * that is not two lines of text at all.
 */

import {
  alpha3ToCountryCode,
  expandExpiryYymmdd,
  inferBirthYymmdd,
  todayUtcYyyymmdd,
} from "@aletheia/credential";

import { isMrzField, verifyCheckDigit } from "./checkdigit.ts";

/** The fixed width of every TD3 MRZ line. */
export const TD3_LINE_LENGTH = 44;

/** Sex as printed in the MRZ; `<` (unspecified) is surfaced as `"X"`. */
export type MrzSex = "M" | "F" | "X";

/** The fields a TD3 line 2 yields, already normalised toward the credential schema. */
export interface Td3CandidateFields {
  /**
   * The passport number, filler stripped. Validated by its check digit and surfaced for
   * the review step. It is never signed, stored on any wire, or used as a public proof
   * input as itself; its one use is as an input to `documentKey` — a private, on-device
   * intermediate — via {@link deriveDocumentKey} (`docs/passport-extraction.md`).
   */
  documentNumber: string;
  /** The ICAO alpha-3 nationality code exactly as read, for display alongside the map. */
  nationalityAlpha3: string;
  /** ISO 3166-1 numeric nationality, e.g. 356 for India. */
  nationality: number;
  /** Date of birth, YYYYMMDD UTC, century inferred against the current date. */
  dateOfBirth: number;
  /** Date of expiry, YYYYMMDD UTC. Always this century. */
  expiryDate: number;
  /** Sex, or `"X"` when the MRZ leaves it unspecified. */
  sex: MrzSex;
}

/**
 * What went wrong with one field. Every issue names the `field` so the review step can
 * point at it — this is the difference between "re-scan" and "re-scan the date of birth".
 */
export type Td3IssueCode =
  /** The input is not two 44-character lines of MRZ characters, or line 1 is not a passport. */
  | "structure"
  /** A field's ICAO check digit does not match: the field was misread. */
  | "check-digit"
  /** The digits do not form a real calendar date. */
  | "invalid-date"
  /** The date of birth's century is genuinely ambiguous; the holder must confirm it. */
  | "ambiguous-century"
  /** The nationality code has no ISO 3166-1 numeric equivalent. */
  | "unsupported-nationality";

/** One problem found while parsing, tied to the field it concerns. */
export interface Td3Issue {
  code: Td3IssueCode;
  /**
   * The field the issue is about: `documentNumber`, `nationality`, `dateOfBirth`, `sex`,
   * `expiryDate`, `composite`, `line1`, or `line2`.
   */
  field: string;
  detail: string;
}

/**
 * The result of parsing a TD3 MRZ: either the candidate fields, or the list of everything
 * that stopped them from being trustworthy. Never both — a single failing check digit is
 * enough to make the whole read suspect, so no fields are returned when any issue is found.
 */
export type Td3ExtractionResult =
  | { ok: true; fields: Td3CandidateFields }
  | { ok: false; issues: Td3Issue[] };

/** Options for {@link parseTd3Mrz}. */
export interface ParseTd3Options {
  /**
   * "Now", for century inference of the date of birth. Injected so tests are deterministic
   * and so the caller controls the clock; defaults to the current UTC date.
   */
  now?: Date;
}

/** Split raw input into two lines, tolerating surrounding whitespace and blank lines. */
function toLines(input: string | { line1: string; line2: string }): string[] {
  if (typeof input !== "string") {
    return [input.line1, input.line2];
  }
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Parse a TD3 passport MRZ (two 44-character lines) into candidate credential fields.
 *
 * Accepts either the raw two-line string or an explicit `{ line1, line2 }`. Structural
 * faults — wrong line count, wrong length, characters outside the MRZ set — are reported
 * as issues and stop field extraction, because positions cannot be trusted once the shape
 * is wrong.
 */
export function parseTd3Mrz(
  input: string | { line1: string; line2: string },
  options: ParseTd3Options = {},
): Td3ExtractionResult {
  const lines = toLines(input);
  const issues: Td3Issue[] = [];

  if (lines.length !== 2) {
    return {
      ok: false,
      issues: [
        {
          code: "structure",
          field: "line2",
          detail: `expected 2 MRZ lines, got ${lines.length}`,
        },
      ],
    };
  }

  const [line1, line2] = lines as [string, string];

  for (const [name, line] of [
    ["line1", line1],
    ["line2", line2],
  ] as const) {
    if (line.length !== TD3_LINE_LENGTH) {
      issues.push({
        code: "structure",
        field: name,
        detail: `expected ${TD3_LINE_LENGTH} characters, got ${line.length}`,
      });
    } else if (!isMrzField(line)) {
      issues.push({
        code: "structure",
        field: name,
        detail: "contains characters outside the MRZ set [A-Z0-9<]",
      });
    }
  }

  // Positions are only meaningful once both lines are well-formed.
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // Line 1 must be a passport (document code "P"); the issuing state is intentionally
  // ignored (docs/passport-extraction.md).
  if (line1[0] !== "P") {
    issues.push({
      code: "structure",
      field: "line1",
      detail: `not a passport MRZ: document code is ${JSON.stringify(line1[0])}, expected "P"`,
    });
  }

  const documentNumberField = line2.slice(0, 9);
  const documentCheck = line2[9] as string;
  const nationalityAlpha3 = line2.slice(10, 13);
  const dobField = line2.slice(13, 19);
  const dobCheck = line2[19] as string;
  const sexChar = line2[20] as string;
  const expiryField = line2.slice(21, 27);
  const expiryCheck = line2[27] as string;
  const personalField = line2.slice(28, 42);
  const personalCheck = line2[42] as string;
  const compositeCheck = line2[43] as string;

  // Per-field check digits. Each failure names its field, because "re-scan the date of
  // birth" is actionable and "re-scan" is not.
  if (!verifyCheckDigit(documentNumberField, documentCheck)) {
    issues.push({
      code: "check-digit",
      field: "documentNumber",
      detail: "document number check digit does not match",
    });
  }
  if (!verifyCheckDigit(dobField, dobCheck)) {
    issues.push({
      code: "check-digit",
      field: "dateOfBirth",
      detail: "date of birth check digit does not match",
    });
  }
  if (!verifyCheckDigit(expiryField, expiryCheck)) {
    issues.push({
      code: "check-digit",
      field: "expiryDate",
      detail: "date of expiry check digit does not match",
    });
  }
  // The personal-number field is optional and often all filler; its check digit is only
  // meaningful when the field carries data.
  if (personalField.replaceAll("<", "").length > 0 && !verifyCheckDigit(personalField, personalCheck)) {
    issues.push({
      code: "check-digit",
      field: "personalNumber",
      detail: "personal number check digit does not match",
    });
  }
  // The composite check covers positions 1-10, 14-20 and 22-43 of line 2.
  const compositeField = line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43);
  if (!verifyCheckDigit(compositeField, compositeCheck)) {
    issues.push({
      code: "check-digit",
      field: "composite",
      detail: "line 2 composite check digit does not match; the read is inconsistent",
    });
  }

  // Nationality: an unsupported code stops the read rather than mapping to a nearest match.
  const nationality = alpha3ToCountryCode(nationalityAlpha3);
  if (nationality === null) {
    issues.push({
      code: "unsupported-nationality",
      field: "nationality",
      detail: `nationality code ${JSON.stringify(nationalityAlpha3)} has no ISO 3166-1 numeric equivalent`,
    });
  }

  // Sex: M, F, or unspecified (<). Anything else is a misread of a fixed-alphabet field.
  let sex: MrzSex | null = null;
  if (sexChar === "M" || sexChar === "F") {
    sex = sexChar;
  } else if (sexChar === "<") {
    sex = "X";
  } else {
    issues.push({
      code: "structure",
      field: "sex",
      detail: `sex is ${JSON.stringify(sexChar)}, expected "M", "F" or "<"`,
    });
  }

  // Dates. Century inference is a fixed rule, never a guess (docs/passport-extraction.md).
  const now = options.now ?? new Date();
  const currentDate = todayUtcYyyymmdd(now);

  const dob = parseSixDigits(dobField);
  let dateOfBirth: number | null = null;
  if (dob === null) {
    issues.push({
      code: "invalid-date",
      field: "dateOfBirth",
      detail: `date of birth ${JSON.stringify(dobField)} is not six digits`,
    });
  } else {
    const inferred = inferBirthYymmdd(dob.yy, dob.mm, dob.dd, currentDate);
    if (inferred.kind === "resolved") {
      dateOfBirth = inferred.value;
    } else if (inferred.kind === "ambiguous") {
      issues.push({
        code: "ambiguous-century",
        field: "dateOfBirth",
        detail:
          `date of birth ${JSON.stringify(dobField)} is a century ambiguous between ` +
          `19${pad2(dob.yy)} and 20${pad2(dob.yy)}; the holder must confirm it`,
      });
    } else {
      issues.push({
        code: "invalid-date",
        field: "dateOfBirth",
        detail: `date of birth ${JSON.stringify(dobField)} is not a real calendar date`,
      });
    }
  }

  const expiry = parseSixDigits(expiryField);
  let expiryDate: number | null = null;
  if (expiry === null) {
    issues.push({
      code: "invalid-date",
      field: "expiryDate",
      detail: `date of expiry ${JSON.stringify(expiryField)} is not six digits`,
    });
  } else {
    try {
      expiryDate = expandExpiryYymmdd(expiry.yy, expiry.mm, expiry.dd);
    } catch {
      issues.push({
        code: "invalid-date",
        field: "expiryDate",
        detail: `date of expiry ${JSON.stringify(expiryField)} is not a real calendar date`,
      });
    }
  }

  if (
    issues.length > 0 ||
    nationality === null ||
    sex === null ||
    dateOfBirth === null ||
    expiryDate === null
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    fields: {
      documentNumber: documentNumberField.replaceAll("<", ""),
      nationalityAlpha3,
      nationality,
      dateOfBirth,
      expiryDate,
      sex,
    },
  };
}

interface SixDigitDate {
  yy: number;
  mm: number;
  dd: number;
}

/** Split a six-character MRZ date into YY/MM/DD, or `null` if it is not six digits. */
function parseSixDigits(field: string): SixDigitDate | null {
  if (!/^[0-9]{6}$/.test(field)) return null;
  return {
    yy: Number(field.slice(0, 2)),
    mm: Number(field.slice(2, 4)),
    dd: Number(field.slice(4, 6)),
  };
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
