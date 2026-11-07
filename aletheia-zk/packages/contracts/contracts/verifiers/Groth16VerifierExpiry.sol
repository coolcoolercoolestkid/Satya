// GENERATED FILE — DO NOT EDIT.
// snarkjs groth16 verifier for circuits/expiry.circom, exported by
// scripts/export-verifier.ts. The only change from snarkjs's output is the
// contract name (Groth16Verifier -> Groth16VerifierExpiry).
//
// Regenerating this file after a new trusted setup invalidates any deployed copy:
// the verification key is baked into the constants below.
// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16VerifierExpiry {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 19359279875810426362537207554212387635939483263520931188920277025178321234033;
    uint256 constant alphay  = 19788141401129681802948888153764963967446376554530989149774944813779849029581;
    uint256 constant betax1  = 13528330386313408970433696105868645005697656257159829832200334095357144185325;
    uint256 constant betax2  = 18702561205799305398015502495232022856177676087776911795571818686742696591044;
    uint256 constant betay1  = 16987845408927322905341890019119004200142833951052451019332276036229226804642;
    uint256 constant betay2  = 14319824683979996084444695676834302283263981740667114763699122984069675047677;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 12825125411566399586410537429162785411311133326395180528424702836490560281144;
    uint256 constant deltax2 = 920440373071698370942150760942997681795183245582498771274309162181687563737;
    uint256 constant deltay1 = 17316693742159995602591669499314271257304209928855156605087564022277915875147;
    uint256 constant deltay2 = 6244941818335277081230204503814640900264046828803346194362236009031028387573;

    
    uint256 constant IC0x = 12322873507891985000508652302390905730869332350497590731162168882727783583523;
    uint256 constant IC0y = 11676514561383159916096319508899819787970199111868440908865040462105407426158;
    
    uint256 constant IC1x = 18068117166556621165409692844098054608537459402417176766018845535620681698858;
    uint256 constant IC1y = 19585178468702755313061480104686923963409909070744666955380484879817667864540;
    
    uint256 constant IC2x = 14065262717381762686473760396323837776863374407588585459025886760345081654797;
    uint256 constant IC2y = 2909864948376799841650625112205529389571575482099185559412567576929467345512;
    
    uint256 constant IC3x = 9897539114649964708938664472573545033681799030902837529243306398552297387462;
    uint256 constant IC3y = 14201220405282291672317134985954136805204750164714097940045855310111255328448;
    
    uint256 constant IC4x = 15886710950857154309936471558134545610662340924501051052373604718664027720212;
    uint256 constant IC4y = 9735153456182557638773369687996090253411657656222569107775880554197852785773;
    
    uint256 constant IC5x = 20798938936428339079950179910050308472871406918588610801433273966853483800429;
    uint256 constant IC5y = 9436821391278481499879911602982032700934013554229497930867832685747828055397;
    
    uint256 constant IC6x = 20024474204416991701661385327510445701122099979585232687851716223023955326864;
    uint256 constant IC6y = 12404353561948135343508548131916400774329687620257507725496428443035441933930;
    
    uint256 constant IC7x = 15515277750810235706641537861761899563395411942012067270320492042168765104121;
    uint256 constant IC7y = 2904888930863631372279319883987356256183356935417831481975208111574691748806;
    
    uint256 constant IC8x = 14545882007392074098681397992516964217417435321727840406841778375497445268591;
    uint256 constant IC8y = 2109791172112340284609117519088808137934402689823080792819429974854413594778;
    
    uint256 constant IC9x = 2476069615039621452500568905879899404446155290708955695360408055979674166480;
    uint256 constant IC9y = 7088137900190337158831883020646055100800069118359593514151705565911646347482;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[9] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
