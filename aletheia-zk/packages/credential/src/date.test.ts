import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_DATE_YYYYMMDD, MIN_DATE_YYYYMMDD } from "./constants.ts";
import {
  ageThresholdYyyymmdd,
  completedYears,
  dateToYyyymmdd,
  daysInMonth,
  isLeapYear,
  isUnexpired,
  isValidYyyymmdd,
  satisfiesMinimumAge,
  toYyyymmdd,
  yyyymmddToDate,
} from "./date.ts";

/** Every UTC calendar date in the supported range, in order. */
function* everySupportedDate(): Generator<{ value: number; date: Date }> {
  const end = Date.UTC(2100, 11, 31);
  for (let t = Date.UTC(1900, 0, 1); t <= end; t += 86_400_000) {
    const date = new Date(t);
    yield {
      value:
        date.getUTCFullYear() * 10000 +
        (date.getUTCMonth() + 1) * 100 +
        date.getUTCDate(),
      date,
    };
  }
}

test("round-trips every date from 1900 to 2100", () => {
  let count = 0;
  for (const { value, date } of everySupportedDate()) {
    assert.equal(dateToYyyymmdd(date), value, `dateToYyyymmdd for ${date.toISOString()}`);
    assert.equal(yyyymmddToDate(value).getTime(), date.getTime(), `inverse for ${value}`);
    assert.ok(isValidYyyymmdd(value), `${value} should be valid`);
    count += 1;
  }
  // 201 years including 49 leap days per century-ish; assert the sweep really ran.
  assert.equal(count, 73_414);
});

test("YYYYMMDD ordering is chronological", () => {
  let previousValue = 0;
  let previousTime = -Infinity;
  for (const { value, date } of everySupportedDate()) {
    assert.ok(value > previousValue, `${value} should exceed ${previousValue}`);
    assert.ok(date.getTime() > previousTime);
    previousValue = value;
    previousTime = date.getTime();
  }
});

test("rejects impossible and out-of-range dates", () => {
  for (const value of [
    20261232, // day 32
    20261301, // month 13
    20260000, // no month or day
    20260230, // February 30
    20260431, // April 31
    18991231, // below range
    21010101, // above range
    2026091, // too few digits
    20260909.5, // not an integer
  ]) {
    assert.equal(isValidYyyymmdd(value), false, `${value} should be rejected`);
  }
  assert.ok(isValidYyyymmdd(MIN_DATE_YYYYMMDD));
  assert.ok(isValidYyyymmdd(MAX_DATE_YYYYMMDD));
  assert.throws(() => toYyyymmdd({ year: 2026, month: 2, day: 30 }), RangeError);
});

test("leap years and February lengths follow the Gregorian rule", () => {
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.ok(isValidYyyymmdd(20000229));
  assert.equal(isValidYyyymmdd(19000229), false);
});

// The table in docs/date-format.md. If this test changes, that document changes.
test("age boundary table from docs/date-format.md", () => {
  const cases: ReadonlyArray<[number, number, number, boolean]> = [
    [20040314, 20260909, 18, true], // comfortably over 18
    [20080909, 20260909, 18, true], // 18th birthday is today
    [20080910, 20260909, 18, false], // 18 tomorrow
    [20081231, 20260101, 18, false], // year rollover
    [20080101, 20260101, 18, true], // year rollover, exact
    [20040229, 20260228, 18, true], // leap-day birth, non-leap year
  ];
  for (const [dateOfBirth, currentDate, minimumAge, expected] of cases) {
    assert.equal(
      satisfiesMinimumAge(dateOfBirth, currentDate, minimumAge),
      expected,
      `dob ${dateOfBirth} on ${currentDate} for age ${minimumAge}`,
    );
  }
});

test("age threshold subtracts whole years and nothing else", () => {
  assert.equal(ageThresholdYyyymmdd(20260909, 18), 20080909);
  assert.equal(ageThresholdYyyymmdd(20260909, 0), 20260909);
  assert.equal(ageThresholdYyyymmdd(20260101, 18), 20080101);
  // A threshold may land on a date that does not exist (2003 had no 29 February).
  // That is sound: comparison is monotone, so the neighbours still answer correctly.
  assert.equal(ageThresholdYyyymmdd(20240229, 21), 20030229);
  assert.equal(satisfiesMinimumAge(20030228, 20240229, 21), true);
  assert.equal(satisfiesMinimumAge(20030301, 20240229, 21), false);
  assert.throws(() => ageThresholdYyyymmdd(20260909, 121), RangeError);
  assert.throws(() => ageThresholdYyyymmdd(20260909, -1), RangeError);
  assert.throws(() => ageThresholdYyyymmdd(20260909, 1.5), RangeError);
  // 120 years before 2026 is still inside the supported range; 120 before 1919 is not.
  assert.equal(ageThresholdYyyymmdd(20260909, 120), 19060909);
  assert.throws(() => ageThresholdYyyymmdd(19010101, 120), RangeError);
});

// The expiry table in docs/date-format.md.
test("expiry boundary table from docs/date-format.md", () => {
  assert.equal(isUnexpired(20340314, 20260909), true);
  assert.equal(isUnexpired(20260909, 20260909), true); // valid through expiry day
  assert.equal(isUnexpired(20260908, 20260909), false);
});

test("completedYears is display-only truncation", () => {
  assert.equal(completedYears(20040314, 20260909), 22);
  assert.equal(completedYears(20040910, 20260909), 21);
});
