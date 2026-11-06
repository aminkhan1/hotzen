# ⚡ HOTZEN — Governed AI Engineering Framework - CLI Cheatsheet

> HOTZEN candidate `2.5.0-rc.1` is not yet published. Registry commands below
> require publication of that exact version; until then use an approved local
> distribution ([INSTALL.md](INSTALL.md)). `core` and `agent-hub-init` remain
> compatible CLI aliases; `agent-hub` remains a local installer alias.
> Remote one-liners below are legacy private bootstrap routes, not public HOTZEN
> endpoints. Normal packaged installation uses bundled resources.


> Quick reference guide for all commands, modes, subcommands, and flags available via `npx hotzen@2.5.0-rc.1` once this exact RC is published. For a local tarball installation, use the same arguments with `hotzen`. See [INSTALL.md](INSTALL.md).

---

## 🎯 Quick Navigation
- [1. Smart Auto-Detection & Instant Deploy](#1-smart-auto-detection--instant-deploy)
- [2. Explicit Stack Selection & Composition](#2-explicit-stack-selection--composition)
- [3. System Diagnostics & Quality Gates (`doctor` & `verify`)](#3-system-diagnostics--quality-gates-doctor--verify)
- [4. AI Bridge Management](#4-ai-bridge-management)
- [5. Safe Simulation Mode (`--dry-run`)](#5-safe-simulation-mode---dry-run)
- [6. Run a Specific npm Version](#6-run-a-specific-npm-version)
- [7. Complete Command Matrix](#7-complete-command-matrix)
- [8. Supported Stacks (28) & Bridges (14)](#8-supported-stacks-28--bridges-14)
- [9. Troubleshooting & Failure Recovery](#9-troubleshooting--failure-recovery)

---

## 1. Smart Auto-Detection & Instant Deploy

### 🚀 Instant Deployment (Recommended)
Inspects repository manifests (`composer.json`, `pubspec.yaml`, `package.json`, `Cargo.toml`, etc.), auto-detects the technology, and prompts you to hit Enter:
```bash
npx hotzen@2.5.0-rc.1
```

### 🔍 Scan & Detect Stack (Read-Only)
Scans the current project (or a target directory) and outputs the detected stack, confidence score, and evidence without modifying any files:
```bash
# Current directory:
npx hotzen@2.5.0-rc.1 detect

# Specific project path:
npx hotzen@2.5.0-rc.1 detect /path/to/my-project
```

---

## 2. Explicit Stack Selection & Composition

### 📌 Deploy a Specific Stack (Manual Override)
Overrides auto-detection and deploys specialized senior skills and architectural rules for a given stack:
```bash
npx hotzen@2.5.0-rc.1 --stack=laravel
npx hotzen@2.5.0-rc.1 --stack=flutter
npx hotzen@2.5.0-rc.1 --stack=react-nextjs
npx hotzen@2.5.0-rc.1 --stack=rust
npx hotzen@2.5.0-rc.1 --stack=python-fastapi
```

### 🧩 Composable Multi-Stack (Polyglot / Fullstack)
Merges multiple technologies into a single workspace (skills and architecture rules are merged cleanly without conflicts):

```bash
# Interactive mode (comma-separated without spaces, e.g. 4,15):
Enter number(s) or name(s) separated by comma [e.g. 4,15 or default: flutter]: 4,15
Enter number(s) or name(s) separated by comma [e.g. 4,15 or default: flutter]: react,laravel

# CLI Flags:
# Frontend + Backend + Database:
npx hotzen@2.5.0-rc.1 --stack=react-nextjs,laravel,database

# Python FastAPI + AI/ML + Database:
npx hotzen@2.5.0-rc.1 --stack=python-fastapi,python-ai-ml,database

# Web + PHP:
npx hotzen@2.5.0-rc.1 --stack=php,vanilla-web
```

---

## 3. System Diagnostics & Quality Gates (`doctor` & `verify`)

### 🩺 System Health Check (`doctor`)
Inspects the repository for Git initialization, pre-commit security hook configuration, enterprise secret scanner installation, governance rule counts, active AI bridges, and memory status:
```bash
npx hotzen@2.5.0-rc.1 doctor

# Inspect a specific path:
npx hotzen@2.5.0-rc.1 doctor /path/to/project
```

### 🧪 Automated Quality Gate (`verify`)
Runs stack-specific lint, type-check, and test suites (e.g., `flutter test`, `npm test`, `php artisan test`, `cargo test`, `pytest`) and reports structured pass/fail results:
```bash
npx hotzen@2.5.0-rc.1 verify

# Verify a specific path:
npx hotzen@2.5.0-rc.1 verify /path/to/project
```

---

## 4. AI Bridge Management

### 🤖 Install Selected Bridges with Stack
By default, `gemini`, `claude`, and `codex` bridges are installed. Use `--bridges` to specify your preferred AI assistants:
```bash
# Install Cursor and Copilot bridges with your stack:
npx hotzen@2.5.0-rc.1 --bridges=cursor,copilot

# Install ALL 14 supported AI bridges:
npx hotzen@2.5.0-rc.1 --bridges=all
```

### 🌉 Standalone Bridge Deployer (`bridge <name>`)
Deploy ONLY the configuration and rules for a specific AI tool without touching existing `.agents/` stacks:
```bash
# Deploy Cursor IDE rules (.cursorrules, .cursor/rules/):
npx hotzen@2.5.0-rc.1 bridge cursor

# Deploy Claude Code settings (.claude/settings.json, CLAUDE.md):
npx hotzen@2.5.0-rc.1 bridge claude

# Deploy GitHub Copilot instructions:
npx hotzen@2.5.0-rc.1 bridge copilot

# Deploy Windsurf rules (.windsurfrules):
npx hotzen@2.5.0-rc.1 bridge windsurf

# Deploy all AI bridges at once:
npx hotzen@2.5.0-rc.1 bridge all
```

---

## 5. Safe Simulation Mode (`--dry-run`)

### 🛡️ Non-Destructive Preview
Preview deployment without applying changes to the target project. Temporary staging files or directories may be created. Shows exactly which files would be created and which would be backed up (`.bak.<timestamp>`):
```bash
# Simulate auto-detect deploy:
npx hotzen@2.5.0-rc.1 --dry-run

# Simulate specific stack deploy:
npx hotzen@2.5.0-rc.1 --stack=flutter --dry-run

# Simulate bridge deployment:
npx hotzen@2.5.0-rc.1 bridge cursor --dry-run
```

---

## 6. Run a Specific npm Version

### 🆙 Run the Published RC
Once this RC is published, version-pinned npx resolves that exact npm version. It may reuse its cache and does not fetch current content directly from GitHub:
```bash
npx hotzen@2.5.0-rc.1
npx hotzen@2.5.0-rc.1 doctor
npx hotzen@2.5.0-rc.1 verify
```

---

## 7. Complete Command Matrix

| Command / Pattern | Type | What It Does |
| :--- | :--- | :--- |
| `npx hotzen@2.5.0-rc.1` | Interactive | Auto-detects project stack & prompts for 1-click Enter deploy |
| `npx hotzen@2.5.0-rc.1 detect [path]` | Subcommand | Scans and prints detected stack, confidence score & evidence |
| `npx hotzen@2.5.0-rc.1 doctor [path]` | Subcommand | Checks health of Git, security hooks, bridges, rules & memory |
| `npx hotzen@2.5.0-rc.1 verify [path]` | Subcommand | Executes stack-appropriate test & lint quality gate |
| `npx hotzen@2.5.0-rc.1 reset` | Subcommand | Purges installed skills in the current working directory |
| `npx hotzen@2.5.0-rc.1 bridge <name>` | Subcommand | Deploys only files for a specific AI agent (`cursor`, `claude`, `all`) |
| `core switch` | CLI Subcommand | Displays model switching status, active model, and adaptive routing |
| `core switch on` | CLI Subcommand | Enables adaptive per-role model switching (lightweight vs strong reasoning) |
| `core switch off [model]` | CLI Subcommand | Locks all roles to the specified model (or provider default) |
| `core lang` | CLI Subcommand | Displays primary detected language and active runtime languages |
| `core lang add <language>` | CLI Subcommand | Adds a secondary language dynamically (persisted in `.agents/memory/runtime_config.json`) |
| `core lang remove <language>` | CLI Subcommand | Removes a secondary runtime language safely |
| `core run "<task>"` | Execution CLI | Runs workflow with mandatory plan approval gate (`[Y] Approve / [N] Reject / [C] Cancel`) and resilient failure recovery (`[R] Retry / [B] Bypass / [C] Cancel`) |
| `--clean` | Option Flag | Purges previous skills before deploying new stack |
| `--stack=<name>` | Option Flag | Specifies explicit stack (e.g. `flutter`, `laravel`, `rust`) |
| `--stack=<s1>,<s2>` | Option Flag | Composes multiple stacks simultaneously |
| `--bridges=<list>` | Option Flag | Specifies which AI bridges to install (`cursor,copilot` or `all`) |
| `--dry-run` | Option Flag | Previews deployment without applying changes to the target project |
| `--help`, `-h` | Option Flag | Prints complete CLI help and usage options |

---

## 8. Supported Stacks (28) & Bridges (14)

### 📦 28 Supported Tech Stacks
`flutter` • `kotlin` • `swift` • `react` • `react-nextjs` • `vue` • `vanilla-web` • `wordpress` • `python-fastapi` • `golang` • `rust` • `cpp` • `java` • `php` • `laravel` • `dotnet` • `nestjs` • `nodejs` • `dart-backend` • `python-ai-ml` • `database` • `solidity` • `unity` • `godot` • `gdscript` • `unreal-engine` • `bash` • `core`

### 🤖 14 Supported AI Bridges (Configuration & Instruction Rules)
`gemini` (Google Antigravity) • `claude` (Anthropic Claude Code) • `codex` (OpenAI Codex) • `cursor` (Cursor IDE) • `copilot` (GitHub Copilot) • `windsurf` • `cline` • `aider` • `deepseek` • `qwen` • `codestral` • `ollama` • `kimi` • `opencode`

> [!NOTE]
> **Provider Execution vs. AI Bridges**:
> AI Bridges configure workspace rules, instruction files, ignore patterns, and MCP settings for 14 AI environments.
> Native execution adapters exist in `core/allocation/adapters/` for **OpenAI Codex** (`codex_adapter.js`, verified with empirical benchmark evidence) and **Claude Code** (`claude_code_adapter.js`, verified with offline test suites and canary pilot). Other bridges provide workspace configuration integration.

---

## 9. Troubleshooting & Failure Recovery

### 🩺 1. What if `doctor` reports warnings (`🟡 ATTENTION NEEDED`)?
The `doctor` subcommand is strictly diagnostic; it inspects repository configuration and outputs structured recommendations:
* **Error: `Git repository not initialized (.git missing)`**
  - **Fix:** Run `git init` in your terminal.
* **Error: `Git pre-commit hook is NOT configured`**
  - **Fix:** Run `git config core.hooksPath .agents/hooks`.
* **Error: `Governance rules (.agents/rules/) or security scanner missing`**
  - **Fix:** Re-run `npx hotzen@2.5.0-rc.1` to auto-repair any missing components without modifying your project source code.

---

### 🧪 2. What if `verify` fails (`🔴 FAILED`)?
The `verify` command runs your actual project test and lint suites. If it fails:
* **Scenario A: Test / Assertion / Logic failure in your codebase**
  - Review the reported failure output in your terminal.
  - You can fix the bug manually, supply the error output to your coding agent (Cursor, Claude, or Antigravity), or use `core run` to address the task within Core's workflow.
* **Scenario B: Toolchain command not found (`command not found`)**
  - The required language SDK or CLI tool (e.g. `dart`, `php`, `cargo`, `pytest`) is not installed or not in your system `$PATH`.

---

### 🌐 3. Explicit Legacy Remote Stack Fetch
Default installation uses bundled resources without implicit private GitHub access. Explicit legacy stack requests (`--remote` or `--force-remote`) may require authorized private-repository access. Only that stack fetch route falls back from Git clone to a tarball.
* If a file rewrite encounters an issue, pre-existing files are always preserved in `<filename>.bak.<timestamp>`.

---

### 🔄 4. What if I accidentally selected the wrong tech stack?
To re-select or switch stacks cleanly without keeping old skills:
* Run `npx hotzen@2.5.0-rc.1 --clean` to purge old skills and select a fresh stack.
* Or run `npx hotzen@2.5.0-rc.1 reset` to clean `.agents/skills` immediately.

---

### ↩️ 5. Clean Rollback or Uninstall
To completely remove the framework from a project and return to its pristine state:
* Delete the `.agents/` folder and any generated bridge files (`GEMINI.md`, `CLAUDE.md`, `CURSOR.md`, `.cursor/`). Your core application code remains untouched and independent.

