// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title AletheiaProfile
 * @notice An opt-in marker that an address uses Aletheia. Nothing more.
 *
 * Deliberately almost empty. It exists so the subgraph can distinguish "this address
 * registered" from "this address happens to appear in a verification", and it is separate
 * from `AletheiaVerifier` so that the contract deciding cryptographic truth holds no
 * identity state.
 *
 * It stores no ENS name. A name written here would be an unverified string that looks
 * authoritative — exactly the kind of fake record this project refuses to create. ENS
 * resolution happens client-side, live, in the direction ENS actually guarantees:
 * name to address.
 */
contract AletheiaProfile {
    mapping(address account => uint64 registeredAt) public registeredAt;

    event ProfileRegistered(address indexed account, uint64 registeredAt);

    error AlreadyRegistered();

    function register() external {
        if (registeredAt[msg.sender] != 0) revert AlreadyRegistered();
        uint64 at = uint64(block.timestamp);
        registeredAt[msg.sender] = at;
        emit ProfileRegistered(msg.sender, at);
    }

    function isRegistered(address account) external view returns (bool) {
        return registeredAt[account] != 0;
    }
}
