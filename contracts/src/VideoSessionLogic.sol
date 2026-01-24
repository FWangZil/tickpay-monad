// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {IERC20} from "./interfaces/IERC20.sol";

/// @title TickPay Video Session Logic - EIP-7702 Delegate Contract
/// @notice Per-second video billing using EIP-7702 account abstraction on Monad
/// @dev Uses fixed storage slots to avoid conflicts when delegated to EOAs
contract VideoSessionLogic {
    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event SessionOpened(bytes32 indexed sessionId, address indexed user, uint256 policyId);
    event SessionCharged(bytes32 indexed sessionId, uint256 secondsBilled, uint256 amount);
    event SessionClosed(bytes32 indexed sessionId);
    event PolicyRevoked(address indexed user);

    /*//////////////////////////////////////////////////////////////
                            CUSTOM ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidSignature();
    error NotAuthorized();
    error SessionIsClosed();
    error SessionExpired();
    error MaxCostExceeded();
    error InvalidPolicy();
    error InvalidSession();
    error TransferFailed();

    /*//////////////////////////////////////////////////////////////
                         STORAGE CONSTANTS
    //////////////////////////////////////////////////////////////*/

    // Fixed storage slots using keccak256 to prevent conflicts
    bytes32 constant POLICY_STORAGE_SLOT = keccak256("tickpay.policy.storage");
    bytes32 constant SESSION_STORAGE_SLOT = keccak256("tickpay.session.storage");

    // EIP-712 domain separator
    string private constant EIP712_DOMAIN_TYPEHASH = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
    bytes32 private constant EIP712_DOMAIN_TYPEHASH_HASH = keccak256(bytes(EIP712_DOMAIN_TYPEHASH));

    string private constant NAME = "TickPay";
    string private constant VERSION = "1";

    // EIP-712 type hash for SessionRequest
    string private constant SESSION_REQUEST_TYPE = "SessionRequest(address user,uint256 policyId,uint256 nonce,uint256 deadline)";
    bytes32 private constant SESSION_REQUEST_TYPEHASH = keccak256(bytes(SESSION_REQUEST_TYPE));

    /*//////////////////////////////////////////////////////////////
                            DATA STRUCTURES
    //////////////////////////////////////////////////////////////*/

    struct Policy {
        address keeper;          // Authorized relayer (only caller of charge)
        address token;           // ERC20 token for payment (no MON to avoid 10 MON reserve)
        address payee;           // Recipient of payments
        uint256 ratePerSecond;   // Billing rate per second
        uint256 maxCost;         // Maximum total charge per session
        uint256 maxSeconds;      // Maximum seconds per session (e.g., 1800 for 30 min)
        uint256 expiry;          // Policy expiration timestamp
        bool enabled;            // Policy status
    }

    struct Session {
        address user;            // Delegated user address
        uint256 policyId;        // Associated policy ID
        uint256 startedAt;       // Session start timestamp
        uint256 chargedSeconds;  // Total seconds charged
        uint256 chargedAmount;   // Total amount charged
        uint256 lastChargeAt;    // Last charge timestamp
        bool closed;             // Session status
    }

    struct SessionRequest {
        address user;
        uint256 policyId;
        uint256 nonce;
        uint256 deadline;
    }

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    // Policy counter for generating unique policy IDs
    uint256 public policyCount;
    // Session counter for generating unique session IDs
    uint256 public sessionCount;

    // User nonce for signature replay protection
    mapping(address => uint256) public nonces;

    /*//////////////////////////////////////////////////////////////
                          CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor() {
        // Initialize counters
        policyCount = 0;
        sessionCount = 0;
    }

    /*//////////////////////////////////////////////////////////////
                         RECEIVE FUNCTION
    //////////////////////////////////////////////////////////////*/

    /// @notice Allow contract to receive native tokens (for EIP-7702 delegated calls)
    /// @dev We don't use native MON to avoid 10 MON reserve rule on Monad
    receive() external payable {}

    /*//////////////////////////////////////////////////////////////
                         CORE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Create a new billing policy
    /// @dev Only callable when contract is not delegated (setup phase)
    /// @param keeper Authorized relayer address
    /// @param token ERC20 token for payments
    /// @param payee Payment recipient
    /// @param ratePerSecond Billing rate per second
    /// @param maxCost Maximum total charge per session
    /// @param maxSeconds Maximum seconds per session
    /// @param expiry Policy expiration timestamp
    /// @return policyId The newly created policy ID
    function createPolicy(
        address keeper,
        address token,
        address payee,
        uint256 ratePerSecond,
        uint256 maxCost,
        uint256 maxSeconds,
        uint256 expiry
    ) external returns (uint256 policyId) {
        require(keeper != address(0), "Invalid keeper");
        require(token != address(0), "Invalid token");
        require(payee != address(0), "Invalid payee");
        require(ratePerSecond > 0, "Invalid rate");
        require(expiry > block.timestamp, "Invalid expiry");

        policyId = policyCount++;
        Policy storage policy = _getPolicy(policyId);
        policy.keeper = keeper;
        policy.token = token;
        policy.payee = payee;
        policy.ratePerSecond = ratePerSecond;
        policy.maxCost = maxCost;
        policy.maxSeconds = maxSeconds;
        policy.expiry = expiry;
        policy.enabled = true;
    }

    /// @notice Open a new billing session with EIP-712 signature verification
    /// @dev Verifies user signature before creating session
    /// @param request Session parameters
    /// @param signature EIP-712 signature from user
    /// @return sessionId The newly created session ID
    function openSession(SessionRequest calldata request, bytes calldata signature)
        external
        returns (bytes32 sessionId)
    {
        // Verify EIP-712 signature
        _verifySessionRequest(request, signature);

        // Check deadline
        require(request.deadline >= block.timestamp, "Request expired");

        // Get policy
        Policy storage policy = _getPolicy(request.policyId);
        require(policy.enabled, "Policy disabled");
        require(block.timestamp < policy.expiry, "Policy expired");

        // Create session
        uint256 id = sessionCount++;
        sessionId = keccak256(abi.encodePacked(id, msg.sender, block.timestamp));

        Session storage session = _getSession(sessionId);
        session.user = msg.sender;
        session.policyId = request.policyId;
        session.startedAt = block.timestamp;
        session.chargedSeconds = 0;
        session.chargedAmount = 0;
        session.lastChargeAt = block.timestamp;
        session.closed = false;

        // Increment nonce for replay protection
        nonces[msg.sender]++;

        emit SessionOpened(sessionId, msg.sender, request.policyId);
    }

    /// @notice Charge user for elapsed time (keeper only)
    /// @dev Only callable by authorized keeper (relayer)
    /// @param sessionId Session ID to charge
    /// @param secondsToBill Number of seconds to bill
    function charge(bytes32 sessionId, uint256 secondsToBill) external {
        Session storage session = _getSession(sessionId);
        require(session.user != address(0), "Session not found");
        require(!session.closed, "Session closed");

        Policy storage policy = _getPolicy(session.policyId);
        require(msg.sender == policy.keeper, "Not authorized");
        require(policy.enabled, "Policy disabled");
        require(block.timestamp <= policy.expiry, "Policy expired");

        // Calculate charge amount
        uint256 amount = policy.ratePerSecond * secondsToBill;

        // Enforce limits
        uint256 newChargedAmount = session.chargedAmount + amount;
        require(newChargedAmount <= policy.maxCost, "Max cost exceeded");

        uint256 newChargedSeconds = session.chargedSeconds + secondsToBill;
        require(newChargedSeconds <= policy.maxSeconds, "Max seconds exceeded");

        // Update session state
        session.chargedAmount = newChargedAmount;
        session.chargedSeconds = newChargedSeconds;
        session.lastChargeAt = block.timestamp;

        // Transfer ERC20 tokens from user to payee
        // User must have approved this contract to spend their tokens
        bool success = IERC20(policy.token).transferFrom(session.user, policy.payee, amount);
        require(success, "Transfer failed");

        emit SessionCharged(sessionId, secondsToBill, amount);
    }

    /// @notice Close an active session
    /// @dev Can be called by keeper or user (via EIP-7702 delegated call)
    /// @param sessionId Session ID to close
    function closeSession(bytes32 sessionId) external {
        Session storage session = _getSession(sessionId);
        require(session.user != address(0), "Session not found");
        require(!session.closed, "Already closed");

        // Only keeper or the user themselves can close
        Policy storage policy = _getPolicy(session.policyId);
        require(
            msg.sender == policy.keeper || msg.sender == session.user,
            "Not authorized"
        );

        session.closed = true;
        emit SessionClosed(sessionId);
    }

    /// @notice Revoke policy (user initiated)
    /// @dev Disables policy to prevent further charges
    /// @param policyId Policy ID to revoke
    function revokePolicy(uint256 policyId) external {
        Policy storage policy = _getPolicy(policyId);
        require(policy.enabled, "Policy already disabled");
        require(policy.keeper == msg.sender || policy.payee == msg.sender, "Not authorized");

        policy.enabled = false;
        emit PolicyRevoked(msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                          VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Get session details
    /// @param sessionId Session ID
    /// @return Session data
    function getSession(bytes32 sessionId) external view returns (Session memory) {
        Session memory session = _getSession(sessionId);
        require(session.user != address(0), "Session not found");
        return session;
    }

    /// @notice Get policy details
    /// @param policyId Policy ID
    /// @return Policy data
    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        Policy memory policy = _getPolicy(policyId);
        require(policy.keeper != address(0), "Policy not found");
        return policy;
    }

    /// @notice Calculate current charge for a session
    /// @param sessionId Session ID
    /// @return secondsToBill Seconds to bill based on elapsed time
    /// @return amount Amount to charge
    function calculateCharge(bytes32 sessionId)
        external
        view
        returns (uint256 secondsToBill, uint256 amount)
    {
        Session memory session = _getSession(sessionId);
        Policy memory policy = _getPolicy(session.policyId);

        uint256 elapsed = block.timestamp - session.lastChargeAt;
        secondsToBill = elapsed;
        amount = policy.ratePerSecond * elapsed;
    }

    /*//////////////////////////////////////////////////////////////
                         INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Get policy from fixed storage slot
    function _getPolicy(uint256 policyId) internal pure returns (Policy storage policyPtr) {
        bytes32 slot = keccak256(abi.encodePacked(POLICY_STORAGE_SLOT, policyId));
        assembly {
            policyPtr.slot := slot
        }
    }

    /// @notice Get session from fixed storage slot
    function _getSession(bytes32 sessionId) internal pure returns (Session storage sessionPtr) {
        bytes32 slot = keccak256(abi.encodePacked(SESSION_STORAGE_SLOT, sessionId));
        assembly {
            sessionPtr.slot := slot
        }
    }

    /// @notice Verify EIP-712 signature for session request
    function _verifySessionRequest(SessionRequest calldata request, bytes calldata signature) internal view {
        bytes32 digest = _hashSessionRequest(request);
        address signer = _recoverSigner(digest, signature);

        if (signer != request.user) revert InvalidSignature();
        if (request.nonce != nonces[request.user]) revert("Invalid nonce");
    }

    /// @notice Hash EIP-712 session request
    function _hashSessionRequest(SessionRequest calldata request) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                keccak256(
                    abi.encode(
                        SESSION_REQUEST_TYPEHASH,
                        request.user,
                        request.policyId,
                        request.nonce,
                        request.deadline
                    )
                )
            )
        );
    }

    /// @notice Get EIP-712 domain separator
    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH_HASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Recover signer from digest and signature
    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        return ecrecover(digest, v, r, s);
    }

    /// @notice Split signature into r, s, v components
    function _splitSignature(bytes calldata signature) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(signature.length == 65, "Invalid signature length");

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
    }
}
