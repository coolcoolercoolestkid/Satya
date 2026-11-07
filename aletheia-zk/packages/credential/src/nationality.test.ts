import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { alpha3ToCountryCode, isSupportedAlpha3 } from "./nationality.ts";
import { isCountryCode } from "./credential.ts";

describe("alpha3ToCountryCode", () => {
  it("maps the documented example India → 356", () => {
    assert.equal(alpha3ToCountryCode("IND"), 356);
  });

  it("maps a spread of real codes to their ISO 3166-1 numeric", () => {
    assert.equal(alpha3ToCountryCode("USA"), 840);
    assert.equal(alpha3ToCountryCode("GBR"), 826);
    assert.equal(alpha3ToCountryCode("DEU"), 276);
    assert.equal(alpha3ToCountryCode("FRA"), 250);
    assert.equal(alpha3ToCountryCode("CHN"), 156);
    assert.equal(alpha3ToCountryCode("JPN"), 392);
    // A two-digit numeric, to prove the table stores the number and not a padded string.
    assert.equal(alpha3ToCountryCode("SLB"), 90);
  });

  it("normalises case before lookup", () => {
    assert.equal(alpha3ToCountryCode("ind"), 356);
    assert.equal(alpha3ToCountryCode("Ind"), 356);
  });

  it("returns null for every ICAO code with no ISO numeric equivalent", () => {
    // Stateless, refugee, unspecified.
    for (const code of ["XXA", "XXB", "XXC", "XXX"]) {
      assert.equal(alpha3ToCountryCode(code), null, code);
    }
    // British national subcategories.
    for (const code of ["GBD", "GBN", "GBO", "GBP", "GBS"]) {
      assert.equal(alpha3ToCountryCode(code), null, code);
    }
    // United Nations travel documents.
    for (const code of ["UNO", "UNA", "UNK"]) {
      assert.equal(alpha3ToCountryCode(code), null, code);
    }
  });

  it("returns null for the ICAO specimen's fictional UTO code", () => {
    assert.equal(alpha3ToCountryCode("UTO"), null);
  });

  it("returns null for malformed input rather than throwing", () => {
    assert.equal(alpha3ToCountryCode(""), null);
    assert.equal(alpha3ToCountryCode("IN"), null);
    assert.equal(alpha3ToCountryCode("INDIA"), null);
    assert.equal(alpha3ToCountryCode("I2D"), null);
    assert.equal(alpha3ToCountryCode("<<<"), null);
  });

  it("every mapped code is a valid ISO 3166-1 numeric range", () => {
    // Guards a typo in the table that would produce an out-of-range or non-integer code.
    for (const code of ["IND", "USA", "GBR", "NRU", "MMR", "SSD", "ZWE"]) {
      const numeric = alpha3ToCountryCode(code);
      assert.notEqual(numeric, null, code);
      assert.ok(isCountryCode(numeric as number), `${code} → ${numeric}`);
    }
  });
});

describe("isSupportedAlpha3", () => {
  it("agrees with the lookup", () => {
    assert.equal(isSupportedAlpha3("IND"), true);
    assert.equal(isSupportedAlpha3("XXA"), false);
    assert.equal(isSupportedAlpha3("UTO"), false);
  });
});
