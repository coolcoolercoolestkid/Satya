# Canonical date representation

**Decision: `uint32` in `YYYYMMDD` form.** Example: 14 March 2004 is `20040314`.

One codec (`packages/credential`) and one Solidity library (`DateLib.sol`) implement it,
and every layer uses them: extraction, normalization, issuer signing, circuit inputs,
proof public signals, and on-chain validation.

## Why

| Option | Calendar age in-circuit | Ordering | Verdict |
|---|---|---|---|
| Unix seconds | needs leap-year logic, or an inexact 365.25-day fudge | monotone | rejected |
| Days since epoch | same leap-year problem for "N calendar years" | monotone | rejected |
| `YYYYMMDD` | exact, with one subtraction | monotone | **chosen** |

`YYYYMMDD` values order chronologically under integer comparison, and calendar-year
arithmetic is a single subtraction:

```
age >= N   <=>   dateOfBirth <= currentDate - N * 10000
```

Subtracting `N * 10000` decrements only the year field; month and day pass through
untouched. So the comparison is exact on the birthday itself, with no leap-year or
timezone reasoning inside the circuit.

## Rules

- All dates are **UTC calendar dates**. There is no time-of-day component, and no claim
  in Aletheia depends on one.
- Valid range enforced by the circuits: `19000101 <= date <= 21001231`.
- Every date entering a comparator is range-checked with `Num2Bits(32)` first, so
  finite-field wraparound cannot fake a comparison result.
- `currentDate` is not taken on trust. `AletheiaVerifier` derives today's UTC date from
  `block.timestamp` via `DateLib` and accepts only `{today, today - 1 day}`: one day of
  grace for timezones and proving latency, and no future dates at all.

## Boundary table (age, `minimumAge = 18`)

| `dateOfBirth` | `currentDate` | threshold | result | meaning |
|---|---|---|---|---|
| `20040314` | `20260909` | `20080909` | pass | comfortably over 18 |
| `20080909` | `20260909` | `20080909` | pass | 18th birthday is today |
| `20080910` | `20260909` | `20080909` | fail | 18 tomorrow |
| `20081231` | `20260101` | `20080101` | fail | year rollover |
| `20080101` | `20260101` | `20080101` | pass | year rollover, exact |
| `20040229` | `20260228` | `20080228` | pass | leap-day birth, non-leap year |

## Boundary table (expiry)

| `expiryDate` | `currentDate` | result |
|---|---|---|
| `20340314` | `20260909` | pass |
| `20260909` | `20260909` | pass — expires at end of day |
| `20260908` | `20260909` | fail |

## Known limitations

- No sub-day precision. Accepted: no Phase 1 claim needs it.
- `YYYYMMDD` is a sparse encoding (`20261232` is representable but not a real date).
  Field validity is the issuer's responsibility; the circuits only need range soundness
  for their comparisons to be meaningful, and the codec rejects impossible dates before
  signing.
