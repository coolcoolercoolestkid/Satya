// GENERATED FILE — DO NOT EDIT.
// snarkjs groth16 verifier for circuits/age.circom, exported by
// scripts/export-verifier.ts. The only change from snarkjs's output is the
// contract name (Groth16Verifier -> Groth16VerifierAge).
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

contract Groth16VerifierAge {
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
    uint256 constant deltax1 = 20160391697370321413434989331170673381267637159463659696301450820568072769257;
    uint256 constant deltax2 = 18245413491568173984018667168734245149636952599155185207905232174496479353351;
    uint256 constant deltay1 = 13172955979879644718223255236773115408402070148459914996946390978304159060887;
    uint256 constant deltay2 = 15334929865407523133907556958287368412190923464555555123376494295999391252555;

    
    uint256 constant IC0x = 476446627806450036383651403771290259878120289246191156743836533079597372128;
    uint256 constant IC0y = 3105976322312885895854723326747821998356385884558590361810553622700960885937;
    
    uint256 constant IC1x = 6322242728732329645963337067751023972854826226207508705725907472289351647599;
    uint256 constant IC1y = 15731688800910186533360800590728256293884610057587892760722963863298312311213;
    
    uint256 constant IC2x = 13360121966073618774119876547321445358330925557394013399508828334669263369878;
    uint256 constant IC2y = 12482919217136088881331852518094070191821189664001613675587388476571068930301;
    
    uint256 constant IC3x = 13337484140442062067065245162884480188883362856478506986104080846981044921874;
    uint256 constant IC3y = 16321654292141925755119991052350642421049365590234539417989444652670337319443;
    
    uint256 constant IC4x = 2376244333385687078589291682099365925339753428202178621961440621118007718639;
    uint256 constant IC4y = 2761588973297318023767109939772232426838549432619923549756372273474386862344;
    
    uint256 constant IC5x = 4985029954948572422923154861507736067935375390654826739371651699210832112557;
    uint256 constant IC5y = 5971158631350673470580939127566697927071284418435977178716801764592028082078;
    
    uint256 constant IC6x = 19069023352986073919455399283373263510516304074351277874325091885661032939647;
    uint256 constant IC6y = 4827232833047507606306825695749063564354231700808423550180109155917200295555;
    
    uint256 constant IC7x = 12120102183656224348448086690151811163768130072562335496209984284936466189603;
    uint256 constant IC7y = 16905115321300876894660597708879334846867131848962981945807454086463447986525;
    
    uint256 constant IC8x = 10644349031041502515082283293848294008044899734046611171305900359924266469619;
    uint256 constant IC8y = 7534151402307076887289529505033996281917981094161684010976396279352512378450;
    
    uint256 constant IC9x = 14277940691701564157514044316705764515379912878113002907727935646400395186597;
    uint256 constant IC9y = 20926462204441186921778814519870373762754940820120431898198550860566279044696;
    
 
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
