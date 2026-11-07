import assert from "node:assert/strict";
import { test } from "node:test";

import { expandExpiryYymmdd, inferBirthYymmdd } from "./date.ts";

// A fixed "today" so the century rule is deterministic. Matches the Day 17 fixtures.
const NOW = 20260911;

test("expiry is always 20YY", () => {
  assert.equal(expandExpiryYymmdd(30, 1, 2), 20300102);
  assert.equal(expandExpiryYymmdd(0, 12, 31), 20001231);
  assert.equal(expandExpiryYymmdd(99, 6, 15), 20990615);
});

test("expiry with an impossible calendar date throws rather than guessing", () => {
  assert.throws(() => expandExpiryYymmdd(30, 13, 1), RangeError);
  assert.throws(() => expandExpiryYymmdd(30, 2, 30), RangeError);
});

test("date of birth: a recent two-digit year resolves to 19YY when 20YY is in the future", () => {
  // 1988: the 2088 reading has not happened yet, so there is no ambiguity.
  assert.deepEqual(inferBirthYymmdd(88, 5, 15, NOW), { kind: "resolved", value: 19880515 });
  // 1955.
  assert.deepEqual(inferBirthYymmdd(55, 1, 1, NOW), { kind: "resolved", value: 19550101 });
});

test("date of birth: an old two-digit year resolves to 20YY when 19YY exceeds a lifetime", () => {
  // 1900/1901/1905 would be 120+ years old (beyond the holder cap), so 20YY is forced.
  assert.deepEqual(inferBirthYymmdd(0, 1, 1, NOW), { kind: "resolved", value: 20000101 });
  assert.deepEqual(inferBirthYymmdd(5, 3, 3, NOW), { kind: "resolved", value: 20050303 });
});

test("date of birth: both readings plausible for a would-be centenarian is ambiguous", () => {
  // 2020 (age 6) vs 1920 (age 106): both are living-holder candidates, so never guess.
  assert.deepEqual(inferBirthYymmdd(20, 1, 15, NOW), { kind: "ambiguous" });
  // 2006 (age 20) vs 1906 (age 120, exactly at the cap): still ambiguous.
  assert.deepEqual(inferBirthYymmdd(6, 1, 1, NOW), { kind: "ambiguous" });
});

test("date of birth: a future date in both centuries is invalid", () => {
  // 2027 is next year, 1927 would be 99 — wait, that resolves. Use a month/day guard:
  // year 27 → 2027 future, 1927 age 99 → resolves to 1927, not invalid.
  assert.deepEqual(inferBirthYymmdd(27, 1, 1, NOW), { kind: "resolved", value: 19270101 });
});

test("date of birth: an impossible calendar date is invalid, not a guess", () => {
  assert.deepEqual(inferBirthYymmdd(90, 13, 1, NOW), { kind: "invalid" });
  assert.deepEqual(inferBirthYymmdd(90, 2, 30, NOW), { kind: "invalid" });
});

test("date of birth: Feb 29 resolves to the century whose year is a leap year", () => {
  // year 00: 2000 is a leap year, 1900 is not. 2000-02-29 is valid and in the past.
  assert.deepEqual(inferBirthYymmdd(0, 2, 29, NOW), { kind: "resolved", value: 20000229 });
  // year 96: 1996 leap and in the past; 2096 is the future. Resolves to 1996.
  assert.deepEqual(inferBirthYymmdd(96, 2, 29, NOW), { kind: "resolved", value: 19960229 });
});
