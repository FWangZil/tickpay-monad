// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {VideoSessionLogic} from "../src/VideoSessionLogic.sol";

contract DeployVideoSession is Script {
    MockERC20 public token;
    VideoSessionLogic public logic;

    uint256 constant INITIAL_SUPPLY = 1_000_000 ether; // 1 million tokens
    uint256 constant RATE_PER_SECOND = 0.001 ether; // 0.001 tokens per second
    uint256 constant MAX_COST = 30 ether; // Max 30 tokens per session
    uint256 constant MAX_SECONDS = 1800; // Max 30 minutes
    uint256 constant EXPIRY = 365 days; // 1 year

    function run() external returns (address tokenAddress, address logicAddress, uint256 policyId) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address keeper = vm.envAddress("KEEPER_ADDRESS");
        address payee = vm.envAddress("PAYEE_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy MockERC20 token
        token = new MockERC20(INITIAL_SUPPLY);
        tokenAddress = address(token);

        // Deploy VideoSessionLogic
        logic = new VideoSessionLogic();
        logicAddress = address(logic);

        // Create initial policy
        policyId = logic.createPolicy(
            keeper,
            tokenAddress,
            payee,
            RATE_PER_SECOND,
            MAX_COST,
            MAX_SECONDS,
            block.timestamp + EXPIRY
        );

        vm.stopBroadcast();

        console.log("MockERC20 deployed at:", tokenAddress);
        console.log("VideoSessionLogic deployed at:", logicAddress);
        console.log("Policy ID:", policyId);
        console.log("Keeper:", keeper);
        console.log("Payee:", payee);
        console.log("Rate per second:", RATE_PER_SECOND);
        console.log("Max cost:", MAX_COST);
        console.log("Max seconds:", MAX_SECONDS);

        return (tokenAddress, logicAddress, policyId);
    }
}
