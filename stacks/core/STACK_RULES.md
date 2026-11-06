# 🌐 Universal Core Architecture & Engineering Rules

## 1. Core Architecture & Folder Hierarchy
- **Clean Architecture & Boundary Isolation**:
  - `domain/` (or `core/`): Pure business logic, entity models, domain exceptions, and abstract repository/service interfaces. Completely decoupled from frameworks, UI, or databases.
  - `data/` (or `infrastructure/`): Concrete implementations of domain interfaces, database adapters, API clients, and persistence logic.
  - `presentation/` (or `handlers/`, `ui/`): UI components, CLI controllers, or HTTP route handlers that interact with users or external clients.
- **Dependency Inversion**: High-level modules must never depend on low-level modules; both must depend on abstract interfaces or contracts.

## 2. Deterministic Quality Standards
- **Explicit Typing**: Enforce explicit type annotations, sound null safety, and strict compile/type-check passes. Avoid untyped dynamic fallbacks (`any`, `Object`, `interface{}`) in domain contracts.
- **Error Handling**: Handle errors explicitly and idiomatically. Never swallow exceptions or leave empty catch blocks.
- **Over-Engineering Elimination (KISS)**: Choose the simplest viable design. Do not add speculative abstractions, utility layers, or premature patterns for requirements that do not yet exist.

## 3. Pre-Delivery Quality Gate & Scoped Verification
- **Targeted & Scoped Verification**: Only run linters, static analysis, and automated tests that directly pertain to the active task and modified files. Never blindly run unrelated test suites.
- **Zero External Side-Effects (Absolute Red Line)**: Automated tests and execution scripts must NEVER send live requests to real services (e.g. real emails, SMS gateways, payment providers, or live webhooks). Use Mock, Null, or Log-Only drivers.
- **Single-Pass Sufficient Verification**: Stop immediately once static analysis and targeted tests pass with 0 errors and 0 warnings.
- **Test Artifact Lifecycle**: Ephemeral scratch scripts must be cleaned up before task conclusion or graduated to the permanent `test/` hierarchy with mock drivers.

## 4. Strict Git Human Guardian Law (Mandatory)
- **Zero Autonomous Commits**: Never execute `git commit`, `git push`, `git merge`, `git rebase`, or edit changelogs without explicit human approval.
- **Inspect Before Staging**: Always show `git status` and a concise summary of changes before requesting approval to commit.
