// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DateLib} from "../lib/DateLib.sol";

/**
 * @title DateLibHarness
 * @notice Test-only. Exposes `DateLib` so it can be compared against the TypeScript date
 * codec over many dates in a single `eth_call` instead of thousands of round trips.
 *
 * Not part of the protocol and never deployed to a public network.
 */
contract DateLibHarness {
    function toYyyymmdd(uint256 timestamp) external pure returns (uint32) {
        return DateLib.toYyyymmdd(timestamp);
    }

    function toYyyymmddBatch(uint256[] calldata timestamps)
        external
        pure
        returns (uint32[] memory dates)
    {
        dates = new uint32[](timestamps.length);
        for (uint256 i = 0; i < timestamps.length; i++) {
            dates[i] = DateLib.toYyyymmdd(timestamps[i]);
        }
    }
}
