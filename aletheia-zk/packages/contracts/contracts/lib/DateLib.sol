// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title DateLib
 * @notice Converts a Unix timestamp to the YYYYMMDD encoding Aletheia uses everywhere.
 *
 * The chain is the only source of "now" that a holder cannot choose. `AletheiaVerifier`
 * derives today's UTC date from `block.timestamp` and compares it against the
 * `currentDate` public signal, which is what stops a backdated or future-dated proof.
 *
 * The encoding must agree exactly with `packages/credential/src/date.ts`; a mismatch
 * would make valid proofs unverifiable near midnight. A test compares the two over ten
 * thousand dates rather than trusting that they agree.
 */
library DateLib {
    /// @dev Days from 1970-01-01 to 0000-03-01, the shifted epoch used below.
    uint256 private constant DAYS_TO_SHIFTED_EPOCH = 719468;
    uint256 private constant SECONDS_PER_DAY = 86400;

    /**
     * @notice Convert a Unix timestamp to YYYYMMDD in UTC.
     *
     * Howard Hinnant's civil-from-days algorithm, which is exact for every date in the
     * supported range and needs no lookup tables or leap-year branching. Years are
     * shifted to start in March so that the leap day falls at the end of the year.
     */
    function toYyyymmdd(uint256 timestamp) internal pure returns (uint32) {
        unchecked {
            uint256 z = timestamp / SECONDS_PER_DAY + DAYS_TO_SHIFTED_EPOCH;
            uint256 era = z / 146097;
            uint256 dayOfEra = z - era * 146097;
            uint256 yearOfEra =
                (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365;
            uint256 year = yearOfEra + era * 400;
            uint256 dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100);
            uint256 shiftedMonth = (5 * dayOfYear + 2) / 153;
            uint256 day = dayOfYear - (153 * shiftedMonth + 2) / 5 + 1;
            uint256 month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
            if (month <= 2) {
                year += 1;
            }
            return uint32(year * 10000 + month * 100 + day);
        }
    }
}
