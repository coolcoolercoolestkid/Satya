import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dateToYyyymmdd, isValidYyyymmdd } from "@aletheia/credential";
import { network } from "hardhat";

/**
 * DateLib must agree with the TypeScript codec exactly.
 *
 * If they disagree by a day, a proof built by the client near midnight is rejected by
 * the contract for no reason a user could understand. Every day in the range is
 * compared rather than a handful of hand-picked ones, because the interesting cases are
 * leap days, century boundaries and month ends, and a sparse sample misses them.
 *
 * The domain starts at the Unix epoch, not at the codec's 1900 floor: `DateLib` takes a
 * `uint256` timestamp and is only ever fed `block.timestamp` (see `AletheiaVerifier`),
 * which converts "now" into `currentDate` and never touches a birth or expiry date.
 * A date before 1970 is a negative Unix timestamp, unrepresentable as `uint256` and
 * never produced by any chain clock, so it is out of the library's domain by
 * construction. The two implementations are compared directly against each other, never
 * against a third precomputed table.
 */
describe("DateLib", async () => {
  const { viem } = await network.create();
  const dateLib = await viem.deployContract("DateLibHarness");

  async function batchToYyyymmdd(timestamps: readonly bigint[]): Promise<number[]> {
    const actual: number[] = [];
    for (let offset = 0; offset < timestamps.length; offset += 2_000) {
      const chunk = timestamps.slice(offset, offset + 2_000);
      const dates = await dateLib.read.toYyyymmddBatch([chunk]);
      actual.push(...dates.map((date) => Number(date)));
    }
    return actual;
  }

  it("matches the TypeScript date codec on every day across the supported range", async () => {
    const startTimestamp = Date.UTC(1970, 0, 1) / 1000;
    // The codec supports dates up to 2100-12-31; sampling past it would be testing the
    // test, not the library.
    const endTimestamp = Date.UTC(2100, 11, 31) / 1000;
    const timestamps: bigint[] = [];
    const expected: number[] = [];

    // Every single day from 1970-01-01 to 2100-12-31: ~47,800 samples, so every month
    // length, every leap year, and both century rules (2000 leap, 2100 not) are hit
    // exactly rather than straddled by a coarse step.
    for (let timestamp = startTimestamp; timestamp <= endTimestamp; timestamp += 86_400) {
      timestamps.push(BigInt(timestamp));
      expected.push(dateToYyyymmdd(new Date(timestamp * 1000)));
    }
    assert.ok(timestamps.length > 10_000, `expected over 10,000 samples, got ${timestamps.length}`);

    const actual = await batchToYyyymmdd(timestamps);

    assert.deepEqual(actual, expected);
  });

  it("agrees on every leap-year boundary in the supported range", async () => {
    // The named property the range test also covers, made explicit: for every year the
    // library can see, the Feb 28 / Feb 29 / Mar 1 transition and the year rollover are
    // compared directly against the codec. A century year is a leap year only when
    // divisible by 400, so 2000 has a Feb 29 and 2100 does not — both are in range.
    const timestamps: bigint[] = [];
    const expected: number[] = [];
    for (let year = 1970; year <= 2100; year++) {
      const days = [
        Date.UTC(year, 1, 28) / 1000, // Feb 28
        Date.UTC(year, 1, 29) / 1000, // Feb 29 or Mar 1 on a non-leap year
        Date.UTC(year, 2, 1) / 1000, // Mar 1
        Date.UTC(year, 11, 31) / 1000, // Dec 31
        // Jan 1 of the next year, except past 2100-12-31, which is out of codec range.
        ...(year < 2100 ? [Date.UTC(year + 1, 0, 1) / 1000] : []),
      ];
      for (const timestamp of days) {
        timestamps.push(BigInt(timestamp));
        expected.push(dateToYyyymmdd(new Date(timestamp * 1000)));
      }
    }

    const actual = await batchToYyyymmdd(timestamps);

    assert.deepEqual(actual, expected);
  });

  it("handles the boundaries that break naive implementations", async () => {
    const cases: ReadonlyArray<[string, number, number]> = [
      ["unix epoch", Date.UTC(1970, 0, 1) / 1000, 19700101],
      ["leap day 2000", Date.UTC(2000, 1, 29) / 1000, 20000229],
      ["1900 was not a leap year, 2000 was", Date.UTC(2000, 2, 1) / 1000, 20000301],
      ["leap day 2024", Date.UTC(2024, 1, 29) / 1000, 20240229],
      ["2100 is not a leap year", Date.UTC(2100, 1, 28) / 1000, 21000228],
      ["day after 2100-02-28", Date.UTC(2100, 2, 1) / 1000, 21000301],
      ["last second of a year", Date.UTC(2025, 11, 31, 23, 59, 59) / 1000, 20251231],
      ["first second of a year", Date.UTC(2026, 0, 1, 0, 0, 0) / 1000, 20260101],
      ["month end", Date.UTC(2026, 3, 30) / 1000, 20260430],
    ];

    for (const [label, timestamp, want] of cases) {
      const got = await dateLib.read.toYyyymmdd([BigInt(timestamp)]);
      assert.equal(Number(got), want, label);
    }
  });

  it("truncates the time of day rather than rounding it", async () => {
    // Any moment during a UTC day maps to that day. Rounding up would let a proof
    // built late in the evening claim tomorrow's date.
    const midnight = Date.UTC(2026, 5, 15) / 1000;
    for (const secondsIntoDay of [0, 1, 3_600, 43_200, 86_399]) {
      const got = await dateLib.read.toYyyymmdd([BigInt(midnight + secondsIntoDay)]);
      assert.equal(Number(got), 20260615);
    }
  });

  it("produces dates the TypeScript validator accepts", async () => {
    for (const year of [1970, 2000, 2026, 2100]) {
      for (const month of [0, 1, 6, 11]) {
        const got = await dateLib.read.toYyyymmdd([BigInt(Date.UTC(year, month, 15) / 1000)]);
        assert.ok(isValidYyyymmdd(Number(got)), `${got} should be a valid YYYYMMDD`);
      }
    }
  });
});
