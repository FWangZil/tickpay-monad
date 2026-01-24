// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {VideoSessionLogic} from "../src/VideoSessionLogic.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract VideoSessionLogicTest is Test {
    VideoSessionLogic public logic;
    MockERC20 public token;

    uint256 public keeperPrivateKey;
    uint256 public payeePrivateKey;
    uint256 public userPrivateKey;
    address public keeper;
    address public payee;
    address public user;

    uint256 public policyId;
    uint256 constant RATE_PER_SECOND = 1 ether; // 1 token per second
    uint256 constant MAX_COST = 100 ether; // Max 100 tokens per session
    uint256 constant MAX_SECONDS = 1800; // Max 30 minutes
    uint256 constant EXPIRY = 365 days;

    function setUp() public {
        // Setup private keys and derive addresses
        keeperPrivateKey = 0xA1;
        payeePrivateKey = 0xA2;
        userPrivateKey = 0xA3;

        keeper = vm.addr(keeperPrivateKey);
        payee = vm.addr(payeePrivateKey);
        user = vm.addr(userPrivateKey);

        // Deploy contracts
        logic = new VideoSessionLogic();
        token = new MockERC20(1_000_000 ether);

        // Fund user with tokens
        bool success = token.transfer(user, 10_000 ether);
        assertTrue(success);

        // Create policy
        vm.startPrank(keeper);
        policyId = logic.createPolicy(
            keeper,
            address(token),
            payee,
            RATE_PER_SECOND,
            MAX_COST,
            MAX_SECONDS,
            block.timestamp + EXPIRY
        );
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                          POLICY TESTS
    //////////////////////////////////////////////////////////////*/

    function test_CreatePolicy() public {
        VideoSessionLogic.Policy memory policy = logic.getPolicy(policyId);

        assertEq(policy.keeper, keeper);
        assertEq(policy.token, address(token));
        assertEq(policy.payee, payee);
        assertEq(policy.ratePerSecond, RATE_PER_SECOND);
        assertEq(policy.maxCost, MAX_COST);
        assertEq(policy.maxSeconds, MAX_SECONDS);
        assertEq(policy.enabled, true);
    }

    function test_RevokePolicy() public {
        vm.prank(keeper);
        logic.revokePolicy(policyId);

        VideoSessionLogic.Policy memory policy = logic.getPolicy(policyId);
        assertEq(policy.enabled, false);
    }

    /*//////////////////////////////////////////////////////////////
                        SESSION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_OpenSession_ValidSignature() public {
        bytes32 sessionId = _openSession(user, policyId);

        VideoSessionLogic.Session memory session = logic.getSession(sessionId);

        assertEq(session.user, user);
        assertEq(session.policyId, policyId);
        assertGt(session.startedAt, 0);
        assertEq(session.chargedSeconds, 0);
        assertEq(session.chargedAmount, 0);
        assertEq(session.lastChargeAt, session.startedAt);
        assertEq(session.closed, false);
    }

    function test_OpenSession_InvalidSignature() public {
        VideoSessionLogic.SessionRequest memory request = VideoSessionLogic.SessionRequest({
            user: user,
            policyId: policyId,
            nonce: 0,
            deadline: block.timestamp + 1 hours
        });

        // Sign with keeper's key instead of user's key (valid length but wrong signer)
        bytes memory fakeSig = _signSessionRequest(request, keeperPrivateKey);

        vm.expectRevert(VideoSessionLogic.InvalidSignature.selector);
        logic.openSession(request, fakeSig);
    }

    function test_OpenSession_ExpiredRequest() public {
        VideoSessionLogic.SessionRequest memory request = VideoSessionLogic.SessionRequest({
            user: user,
            policyId: policyId,
            nonce: 0,
            deadline: block.timestamp - 1
        });

        bytes memory signature = _signSessionRequest(request, userPrivateKey);

        vm.expectRevert("Request expired");
        logic.openSession(request, signature);
    }

    /*//////////////////////////////////////////////////////////////
                          CHARGE TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Charge_Success() public {
        bytes32 sessionId = _openSession(user, policyId);

        // Approve token transfer
        vm.prank(user);
        token.approve(address(logic), type(uint256).max);

        // Charge 10 seconds
        uint256 secondsToBill = 10;
        vm.prank(keeper);
        logic.charge(sessionId, secondsToBill);

        VideoSessionLogic.Session memory session = logic.getSession(sessionId);

        assertEq(session.chargedSeconds, 10);
        assertEq(session.chargedAmount, 10 ether);

        // Check payee received tokens
        assertEq(token.balanceOf(payee), 10 ether);
    }

    function test_Charge_NotAuthorized() public {
        bytes32 sessionId = _openSession(user, policyId);

        address attacker = address(0x99);
        vm.prank(attacker);
        vm.expectRevert("Not authorized");
        logic.charge(sessionId, 10);
    }

    function test_Charge_MaxCostExceeded() public {
        bytes32 sessionId = _openSession(user, policyId);

        vm.prank(user);
        token.approve(address(logic), type(uint256).max);

        // Charge up to max
        vm.prank(keeper);
        logic.charge(sessionId, 100);

        // Try to charge more (should revert)
        vm.prank(keeper);
        vm.expectRevert("Max cost exceeded");
        logic.charge(sessionId, 1);
    }

    function test_Charge_MaxSecondsExceeded() public {
        // Create a policy with lower rate so maxSeconds is checked before maxCost
        // At 0.05 ether/sec, 2000 seconds = 100 ether (at MAX_COST boundary)
        uint256 newPolicyId;
        uint256 newRatePerSecond = 0.05 ether; // 0.05 tokens per second
        uint256 newMaxCost = 200 ether; // Higher to allow maxSeconds test

        vm.startPrank(keeper);
        newPolicyId = logic.createPolicy(
            keeper,
            address(token),
            payee,
            newRatePerSecond,
            newMaxCost,
            MAX_SECONDS,
            block.timestamp + EXPIRY
        );
        vm.stopPrank();

        bytes32 sessionId = _openSession(user, newPolicyId);

        vm.prank(user);
        token.approve(address(logic), type(uint256).max);

        // Try to charge more than max seconds
        // 1801 seconds * 0.05 ether/sec = 90.05 ether (within newMaxCost of 200 ether)
        vm.prank(keeper);
        vm.expectRevert("Max seconds exceeded");
        logic.charge(sessionId, MAX_SECONDS + 1);
    }

    function test_Charge_SessionClosed() public {
        bytes32 sessionId = _openSession(user, policyId);

        // Close session
        vm.prank(keeper);
        logic.closeSession(sessionId);

        // Try to charge (should revert)
        vm.prank(keeper);
        vm.expectRevert("Session closed");
        logic.charge(sessionId, 10);
    }

    function test_Charge_PolicyExpired() public {
        // Create policy with short expiry
        uint256 shortExpiry = 1 hours;
        vm.prank(keeper);
        uint256 shortPolicyId = logic.createPolicy(
            keeper,
            address(token),
            payee,
            RATE_PER_SECOND,
            MAX_COST,
            MAX_SECONDS,
            block.timestamp + shortExpiry
        );

        bytes32 sessionId = _openSession(user, shortPolicyId);

        // Fast forward past expiry
        vm.warp(block.timestamp + shortExpiry + 1);

        vm.prank(user);
        token.approve(address(logic), type(uint256).max);

        // Try to charge (should revert)
        vm.prank(keeper);
        vm.expectRevert("Policy expired");
        logic.charge(sessionId, 10);
    }

    /*//////////////////////////////////////////////////////////////
                        CLOSE SESSION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_CloseSession_ByKeeper() public {
        bytes32 sessionId = _openSession(user, policyId);

        vm.prank(keeper);
        logic.closeSession(sessionId);

        VideoSessionLogic.Session memory session = logic.getSession(sessionId);
        assertEq(session.closed, true);
    }

    function test_CloseSession_ByUser() public {
        bytes32 sessionId = _openSession(user, policyId);

        vm.prank(user);
        logic.closeSession(sessionId);

        VideoSessionLogic.Session memory session = logic.getSession(sessionId);
        assertEq(session.closed, true);
    }

    function test_CloseSession_AlreadyClosed() public {
        bytes32 sessionId = _openSession(user, policyId);

        vm.prank(keeper);
        logic.closeSession(sessionId);

        vm.prank(keeper);
        vm.expectRevert("Already closed");
        logic.closeSession(sessionId);
    }

    /*//////////////////////////////////////////////////////////////
                        HELPER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _openSession(address _user, uint256 _policyId) internal returns (bytes32) {
        // Get private key for user
        uint256 privateKey = _user == user ? userPrivateKey : keeperPrivateKey;

        VideoSessionLogic.SessionRequest memory request = VideoSessionLogic.SessionRequest({
            user: _user,
            policyId: _policyId,
            nonce: logic.nonces(_user),
            deadline: block.timestamp + 1 hours
        });

        bytes memory signature = _signSessionRequest(request, privateKey);

        vm.prank(_user);
        bytes32 sessionId = logic.openSession(request, signature);

        return sessionId;
    }

    function _signSessionRequest(VideoSessionLogic.SessionRequest memory request, uint256 signerPrivateKey)
        internal
        view
        returns (bytes memory)
    {
        // Encode the EIP-712 typed data
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("TickPay")),
                keccak256(bytes("1")),
                block.chainid,
                address(logic)
            )
        );

        bytes32 requestTypeHash = keccak256(
            bytes("SessionRequest(address user,uint256 policyId,uint256 nonce,uint256 deadline)")
        );

        bytes32 structHash = keccak256(
            abi.encode(
                requestTypeHash,
                request.user,
                request.policyId,
                request.nonce,
                request.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_CalculateCharge() public {
        bytes32 sessionId = _openSession(user, policyId);

        // Fast forward 15 seconds
        vm.warp(block.timestamp + 15);

        (uint256 secondsToBill, uint256 amount) = logic.calculateCharge(sessionId);

        assertEq(secondsToBill, 15);
        assertEq(amount, 15 ether);
    }
}
