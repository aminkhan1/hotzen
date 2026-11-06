# ⛓️ Solidity & Foundry Smart Contract Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Standard Foundry / Modular Smart Contract Layout**:
  - `src/`: Production smart contracts:
    - `src/interfaces/`: Interface definitions (`IERC20.sol`, `IVault.sol`).
    - `src/base/`: Abstract contracts and base storage layouts.
    - `src/libraries/`: Internal helper libraries and custom types.
  - `script/`: Deterministic deployment and governance scripts (`DeployVault.s.sol`).
  - `test/`: Comprehensive Foundry test suite:
    - `test/unit/`: Direct function unit tests.
    - `test/fuzz/`: Property-based fuzz tests with randomized inputs.
    - `test/invariants/`: System-wide invariant assertions (e.g., protocol solvency).
- **Dependencies**: Use OpenZeppelin Contracts v5.x for battle-tested building blocks (`ERC20`, `AccessControl`, `ReentrancyGuard`).

## 2. Senior Smart Contract Security Invariants (Absolute Red Lines)
- **Checks-Effects-Interactions (CEI) Pattern**:
  - Always validate input conditions (`Checks`), update internal contract state (`Effects`), and only then perform external calls or token transfers (`Interactions`).
- **Reentrancy Protection**:
  - Apply `nonReentrant` modifiers on external/public functions involving value or token transfers.
- **Strict Authorization**:
  - Never use `tx.origin` for authorization; strictly use `msg.sender`.
  - Use `AccessControl` with distinct roles (`MINTER_ROLE`, `ADMIN_ROLE`) rather than monolithic ownership for complex protocols.
- **Custom Errors over String Reverts**:
  - Always declare typed custom errors (e.g. `error UnauthorizedAccess(address caller);`, `error InsufficientBalance(uint256 available, uint256 required);`).
  - Avoid `require(condition, "error string")` to optimize bytecode size and deployment gas costs.

## 3. Gas Optimization Guidelines
- **Storage Layout Packing**: Order state variables sequentially to pack multiple values into a single 32-byte storage slot (e.g., `uint128` + `uint128` or `address` + `uint96`).
- **Memory vs. Calldata**: Use `calldata` instead of `memory` for read-only array, struct, or string function parameters in `external` functions.
- **Constants & Immutables**: Mark values known at compile-time as `constant` and values set only during construction as `immutable`.
- **Cache Storage Variables**: Never read storage variables (`SSTORE`/`SLOAD`) repeatedly inside loops; cache them in local stack variables.

## 4. Verification & Testing Matrix
- Run test suite with Foundry: `forge test -vvv`
- Run fuzz and invariant verification: `forge test --fuzz-runs 1000`
- Check static analysis security report: `slither .` (0 high/critical issues required).
