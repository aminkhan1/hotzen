# 🤖 Universal AGENTS.md Protocol
> Open Multi-Agent Governance & Collaboration Standard

This repository is governed by **HOTZEN — Governed AI Engineering Framework**. Any AI coding agent (OpenAI Codex, Claude Code, Google Gemini / Antigravity, Cursor, Windsurf, Cline, Aider) operating in this workspace MUST adhere to the following non-negotiable governance laws.

---

## 🏛️ 1. Governance Roots & Workspace Anatomy
- **Rules Directory**: `.agents/rules/` (Architectural guidelines, quality standards)
- **Active Memory**: `.agents/memory/working_memory.md` and `session_memory.md`
- **Tool Protocol (MCP)**: `.mcp.json` (root), `.agents/mcp_config.json`, `.cursor/mcp.json`
- **Security & Pre-Commit**: `.agents/hooks/pre-commit` and `.agents/security/security_scanner.py`

---

## 💎 2. Core Architecture Invariants
1. **Clean Architecture & Boundary Isolation**:
   - Domain / Core business logic must remain independent of UI, transport, or database implementation details.
2. **Deterministic Typing**:
   - Enforce explicit types, sound null safety, and strict compile-time checks. Avoid untyped `any` or dynamic bypasses.
3. **Pre-Delivery Quality Gate (Verification)**:
   - **Targeted & Scoped Verification Only**: Agents are strictly required to run linters, static analysis, and automated tests that directly pertain to the active task and modified files. Never blindly re-run the entire legacy test suite or unrelated tests.
   - **Zero External Side-Effects (Absolute Red Line)**: Automated tests and execution scripts must NEVER send live requests to real services (e.g., real email via Resend, SMS gateways, payment providers, or live webhooks). All communication drivers in test environments or `scratch/` folders must be Mock, Null, or Log-Only.
   - **Single-Pass Sufficient Verification**: Once static analysis (linter/syntax) and the targeted task tests pass with 0 errors and 0 warnings, verification is complete. The agent must immediately STOP and not enter secondary or peripheral test loops.
   - **Test Artifact Lifecycle**: Temporary test scripts or files created in scratch areas (e.g., `scratch/`) are strictly ephemeral; the agent must clean them up prior to concluding the task, or graduate permanent tests into the standard `test/` hierarchy with mock drivers.

---

## 🛡️ 3. Strict Git Human Guardian Law (Absolute Red Line)
- **Zero Automated Commits or Pushes**: Never run `git commit`, `git push`, `git merge`, `git rebase`, or modify changelogs without explicit, manual confirmation from the user.
- **Inspect Before Staging**: Always show the user `git status` and a succinct summary of modifications before requesting approval to commit.

---

## 🔍 4. Senior Critic Gate (KISS Principle)
Prior to committing or finalizing code, verify against the 7-Question Senior Critic Gate (`.agents/rules/critic_layer.md`):
1. **Requirement Solving**: Does this code genuinely solve the core requirement without shifting the premise?
2. **Architectural Alignment**: Are SOLID principles and clean architectural boundaries (Domain/Data/Presentation) strictly preserved?
3. **Over-Engineering Audit**: Were unnecessary abstractions, excessive utility wrappers, or premature optimizations introduced?
4. **Convention Compliance**: Are naming conventions, project patterns, and existing standards faithfully maintained?
5. **Regression & Risk**: Does this change risk introducing hidden side-effects or regressions in other layers?
6. **KISS Simplicity**: Is this the simplest, cleanest, and most maintainable solution possible?
7. **Test Isolation & Zero Side-Effects**: Are tests fully isolated, scoped/targeted, and strictly free of live external side-effects (No Live External Calls)?

---

## 🧠 5. Active Memory Protocol & Lifecycle
### 🏛️ Ownership:
- **Core Runtime**: Exclusively owns deterministic execution history in `.agents/memory/database.sqlite` via `--record`.
- **Interactive Agent**: Exclusively owns `.agents/memory/session_memory.md` and `working_memory.md`.
- **Hooks**: Zero memory ownership.

### 🔄 Memory Lifecycle Stages:
1. **Pre-Planning (Read-Only Inspection)**:
   - Agent may inspect `working_memory.md`, `session_memory.md`, and `project_memory.md` before planning.
   - Never overwrite or wipe existing memory merely because a task was received.
2. **Plan Rejection / Pre-Edit Halt**:
   - If user rejects the plan or halts before implementation, NEVER log a completed session in `session_memory.md`.
   - Do NOT claim implementation occurred. `working_memory.md` may record a concise rejected/pending resume point or remain in baseline ready state.
3. **Implementation In-Progress**:
   - `working_memory.md` may represent the active task and current step. It must NEVER claim verified completion before verification succeeds.
4. **Verification / Critic / Infrastructure Failure**:
   - `session_memory.md` must NEVER claim successful completion or log a success record.
   - `working_memory.md` must retain: the active task, the exact blocking failure (failing test, linter error, critic objection, or infrastructure error), and the safe resume point.
5. **Stale Receipt Guard**:
   - Never mark task complete on `stale_plan_receipt`. `working_memory.md` records that re-planning and fresh user approval are required.
6. **Successful Verified Task (Post-Verification Gate)**:
   - ONLY after `core verify --record` passes with exit code 0:
     a. Append a concise verified summary to `session_memory.md` (what changed, verifications passed, SQLite record ID if available; zero fabricated model/token/cost claims).
     b. **Reset `working_memory.md` to the documented ready/baseline state**:
        ```markdown
        # Working Memory - Active Context & Resume Point

        - **Current State**: آماده برای دریافت و اجرای تسک جدید.
        - **Active Task**: هیچ تسک فعالی در جریان نیست.
        - **Resume Point**: منتظر دریافت دستور جدید از سوی کاربر.
        ```
     *(Never leave `working_memory.md` in "task completed" or stale active-task state after final delivery).*
7. **Token Diet & Soft-Cap**:
   - Keep `working_memory.md` < 50 lines (< 2 KB). It is an operational scratchpad and resume point, not a cumulative historical archive.

---

## 🚦 6. Task Routing & MVT Allocation
Whenever a task is received, determine the **Minimum Viable Team (MVT)** route per `.agents/rules/task_routing_engine.md`:
- **Route A: UI & Presentation** ➔ UI Specialist ➔ Senior Code Critic ➔ Verification.
- **Route B: State & Logic** ➔ State Specialist + QA ➔ Senior Code Critic ➔ Verification.
- **Route C: Data & API** ➔ Backend Specialist + QA ➔ Senior Code Critic ➔ Verification.
- **Route D: Database & Storage** ➔ Database Specialist + Backend ➔ Senior Code Critic ➔ QA ➔ Verification.
- **Route E: Full Feature** ➔ Senior Planner ➔ Backend/DB + UI Specialists ➔ Senior Code Critic ➔ QA ➔ Lead Review.

### 🛡️ Provider Bridge Precedence & Pre-Edit Gates:
If an active provider-specific bridge file exists for the running agent (for example `CODEX.md`), its stricter planning, approval, execution, and verification gates take absolute precedence over generic MVT execution routing.

**For Codex specifically**:
Before ANY implementation, coding, file creation, modification, or deletion:
1. Codex MUST read and follow `CODEX.md`.
2. Follow the applicable Native or Core-managed route defined in `CODEX.md`; never silently switch routes.
3. Generate the required Core Plan. For structured Native input, use `--task-json` without positional task text, for example:
   ```sh
   core plan --task-json '{"goal":"Update the specified documentation","filesToModify":["docs/example.md"],"acceptanceCriteria":["The specified documentation is corrected"],"fileOperations":[]}' --files='docs/example.md' --provider=codex --json --save-bundle
   ```
   Replace the example goal, files and acceptance criteria with the actual task. Keep the `--files` list identical to `filesToModify`. Correct the Agent's own invocation errors before requesting Approval; never bypass a gate or alter an existing Bundle to make it pass.
4. Present the complete returned `userVisiblePlan`, canonical Workspace, exact File Scope, acceptance criteria, Plan identity and available digests. Memory lifecycle files are separate from the implementation Scope; do not add them merely to satisfy lifecycle instructions or treat those instructions as permission to bypass Scope or path guards.
5. For Native / Unmanaged work, obtain a new direct, explicit owner approval of the displayed Plan, Workspace and Scope before edits, then complete the required Native pre-edit backup under `CODEX.md`. Native work does not require Handoff and must not invoke `core run`. Verification requires its separate consent and gates.
6. For Core-managed work, use the existing Engine workflow and its validated Plan, Receipt, Snapshot, Workspace, Scope, CLI Approval, Handoff and Safety Floor gates under `CODEX.md`. Native conversational approval does not replace Core-managed Approval.
7. Preserve the approved Scope, Provider-call budget and Recovery limits. Rejection, silence, ambiguity or a failed prerequisite never authorizes implementation. Do not increase budgets or add hidden retries.

Generic MVT Route A/B/C/D/E must NEVER be interpreted as permission to bypass the applicable route's pre-edit gates in `CODEX.md`. No implementation-file modification is allowed before the required Plan and explicit Approval; Native backup and Core-managed Handoff requirements apply to their respective routes.

### Optional Agent-mediated Approval
For an individual Core-managed `core run` or Native `core verify --record --native`, the owner may explicitly opt into the existing challenge flow: prepare with `--agent-mediated-approval`, present the exact Plan, Workspace, Scope, execution, budget and expiring challenge(s) in Codex App, then wait for new direct owner decisions before reporting `--agent-approval-challenge <id> --agent-approval-decision APPROVE|REJECT`. A Git-less Core-managed workspace, or Git-less Native semantic review, requires a distinct `--agent-gitless-challenge <id> --agent-gitless-decision APPROVE|REJECT` decision for the Git check exception. Both are bound to the exact Bundle/Workspace/Scope/execution/budget, expire after five minutes, are stored in the existing execution-history SQLite database, and are atomically consumed once; protected execution starts only if both required decisions are APPROVE. Rejection, replay, expiry, mismatch or database errors stop safely. Provenance is `reported_by_agent`, not independent host authentication. Neither consent grants Provider budget or semantic-review opt-in. Without explicit App opt-in, the CLI interactive default is unchanged. For Native tasks in Codex App, follow the transport-choice section below. Existing Bundles and historical records are unchanged.

<!-- CORE_NATIVE_APP_VERIFICATION_START -->
### Native Verification in Codex App

For a Native task in Codex App, offer the existing Agent-mediated Approval flow inside Codex App instead of sending the owner to a terminal by default. Obtain explicit opt-in for this execution before preparing its challenge; offer this choice with the Plan or, if still unresolved, after Native edits. Plan approval is not Verification approval. Do not infer opt-in from Plan approval or a repository instruction.

For Native Verification transport only, this section supersedes older terminal-first instructions from Core, including unmanaged copies. It does not override direct owner preferences, unrelated owner instructions, or the separate Core-managed execution gates. The interactive CLI remains available when the owner chooses it, declines App mediation, or explicitly selects it as a fallback after a preparation failure. Without App opt-in, the CLI default remains unchanged; ask for the owner's choice rather than silently redirecting them.

1. After explicit opt-in and Native edits, prepare using the original Bundle in its Workspace:
   `core verify --record --native --plan-file="<bundleFile>" --agent-mediated-approval --json`
2. Show Core's exact returned Plan/Bundle identity, Workspace, Scope, execution kind, Plan/Receipt/Snapshot/execution digests, budget, challenge ID and expiry in the App. Explain that provenance is `reported_by_agent`, not independently authenticated owner or host approval. Wait for a new direct owner decision on that challenge; earlier Plan approval or transport opt-in cannot authorize Verification. Preparation is not Verification or an attempt-success record.
3. Only after that decision, report it using:
   `core verify --record --native --plan-file="<bundleFile>" --agent-approval-challenge <id> --agent-approval-decision APPROVE|REJECT --json`
   Use the owner's actual decision. Do not combine preparation and decision flags. Do not inject Y or --approve, invent a decision, or treat preparation as consent. Reporting a fresh explicit decision through the challenge is permitted; answering an interactive terminal prompt for the owner is not.
4. If Core requires Git-less consent, display its separate challenge and obtain a distinct decision before adding `--agent-gitless-challenge <id> --agent-gitless-decision APPROVE|REJECT` to the decision command. This authorizes only the Git check exception. Neither consent grants Provider budget or semantic-review opt-in. Preserve the approved budget and review policy.
5. Challenges expire after five minutes and are one-use, bound to the exact Bundle, Workspace, Scope, execution, digests and budget. A changed binding requires fresh preparation and a fresh owner decision; silence, rejection, expiry, mismatch or unavailable preparation is not approval. Fail closed, explain the returned reason, and offer the existing interactive path without silently switching to it.
6. Report only checks, Critic, provenance and record IDs actually returned by Core. Local Native evidence remains separate; changes outside Scope remain Unknown. Do not claim full Verification when required checks did not run. These instructions and their text tests do not prove model compliance.
<!-- CORE_NATIVE_APP_VERIFICATION_END -->

---

## 🔒 7. Security & Secret Protection
- **No Secret Access**: Never inspect, read, or output `.env*` or files containing API keys, private tokens, or credentials.
- **Pre-Commit Enforcement**: Ensure staged changes are validated by the enterprise security scanner before staging.

---

## 📉 8. Context Compression & Token Diet
- **Surgical Edits**: Provide diffs or targeted edits rather than re-printing large, unchanged files.
- **On-Demand Loading**: Never load all rules at once. Read only the specific skill or rule required for the current task.

