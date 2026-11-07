// GENERATED FILE — DO NOT EDIT.
// snarkjs groth16 verifier for circuits/nationality.circom, exported by
// scripts/export-verifier.ts. The only change from snarkjs's output is the
// contract name (Groth16Verifier -> Groth16VerifierNationality).
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

contract Groth16VerifierNationality {
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
    uint256 constant deltax1 = 1309194953027619397926640400128751229788047590938135396151148652675432357773;
    uint256 constant deltax2 = 8648742229838970986996296395815704483359326153136909447154947253248082289007;
    uint256 constant deltay1 = 6653975114298287718879076286502896816457892503452395429369340501771961221837;
    uint256 constant deltay2 = 1347620116255278144171745905552622007001479948257518870989965383125973657540;

    
    uint256 constant IC0x = 17979150762696150918088058505887259205304687414258431768159770421792067513496;
    uint256 constant IC0y = 5364217693002171130101023730570077363744700961582031492817209991495431608885;
    
    uint256 constant IC1x = 2784346458273939255519851124777564811565712922725048054054160492058800193072;
    uint256 constant IC1y = 6559887106702048206437650721991588676039022027082741974790082703435090599930;
    
    uint256 constant IC2x = 5068697983808639213473397173942741287791864991945965747301799696217683770396;
    uint256 constant IC2y = 620226588804850063810581063031290438388342759778102154984105382706158944495;
    
    uint256 constant IC3x = 5617987188098655054788629876618679790868974980129630276694910777420899585796;
    uint256 constant IC3y = 21352160580375129739224673956593013175649103765457218538049725916851392921045;
    
    uint256 constant IC4x = 20350818183396041501753645452285045469262580675302143901701034709209460915450;
    uint256 constant IC4y = 13713474339505318623508248958843478517260410594975261859128112163737768727865;
    
    uint256 constant IC5x = 11038675769948052916592950145700708055854416246366042826274248342523964567894;
    uint256 constant IC5y = 16461364956785082645903049261549185869535751384400653026580998986642450264147;
    
    uint256 constant IC6x = 14695446270350772202060380212408149110187106704492122374683525172098426867208;
    uint256 constant IC6y = 9196369035582931378827403259022542089795409804394363999625314767500084224813;
    
    uint256 constant IC7x = 16165395206845700545162677699787277785795399269513968333608258975069664797354;
    uint256 constant IC7y = 18597500980446856188073588426695321536366722958268544878119583728222409185727;
    
    uint256 constant IC8x = 5301851959692027564568172404394722101402660884071099778554023516839970507678;
    uint256 constant IC8y = 17037792737443857931010419271082122366748399516965358064735334907843675303532;
    
    uint256 constant IC9x = 7398633930991888786951755724265061172538201981817064115052322941564204865035;
    uint256 constant IC9y = 8801427736523728184339999532488587060788237604398500494569212072371606299301;
    
 
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
