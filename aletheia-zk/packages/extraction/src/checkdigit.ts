/**
 * ICAO 9303 check digits: the weighted `7-3-1` modulus-10 scheme every MRZ field carries.
 *
 * A check digit is a *misread detector*, not evidence of authenticity
 * (`docs/passport-extraction.md`). It catches the failure mode that actually happens to a
 * camera scan — `0` read as `O`, `1` as `I`, `5` as `S`, a blurred glyph — and nothing
 * more: the algorithm is public and deterministic, so a fabricated MRZ carries valid check
 * digits as a matter of course. A failing check digit means *re-scan this field*.
 *
 * Validated against the published ICAO 9303 Part 3 TD3 specimen in `checkdigit.test.ts`.
 */

/** The MRZ character set: digits, A–Z, and the filler `<`. */
const MRZ_CHAR = /^[A-Z0-9<]$/;

/**
 * The numeric value of an MRZ character for the check-digit sum: `<` and letters `A`–`Z`
 * are `0` and `10`–`35`, digits are themselves. Throws on any other character, which is
 * a structural fault the caller should have rejected before reaching here.
 */
export function mrzCharValue(char: string): number {
  if (char === "<") return 0;
  if (char >= "0" && char <= "9") return char.charCodeAt(0) - 48;
  if (char >= "A" && char <= "Z") return char.charCodeAt(0) - 55; // "A" → 10
  throw new RangeError(`not an MRZ character: ${JSON.stringify(char)}`);
}

/** Whether every character of `field` is in the MRZ character set. */
export function isMrzField(field: string): boolean {
  for (const char of field) {
    if (!MRZ_CHAR.test(char)) return false;
  }
  return true;
}

/**
 * The ICAO `7-3-1` modulus-10 check digit of `field`: each character's value weighted by
 * a repeating 7, 3, 1 and summed, modulo 10.
 */
export function computeCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    sum += mrzCharValue(field[i] as string) * (weights[i % 3] as number);
  }
  return sum % 10;
}

/**
 * Whether `checkChar` is the correct check digit for `field`. A `<` filler is accepted
 * only where it is the correct value, i.e. a sum that is `0` mod 10 — this is how ICAO
 * lets an all-filler optional field carry `<` in its check-digit position.
 */
export function verifyCheckDigit(field: string, checkChar: string): boolean {
  const expected = computeCheckDigit(field);
  if (checkChar === "<") return expected === 0;
  if (checkChar < "0" || checkChar > "9") return false;
  return checkChar.charCodeAt(0) - 48 === expected;
}
