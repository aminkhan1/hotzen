# Installation and first use

This guide covers the V1 runtime in package version **2.5.0-rc.1**. Installing the CLI,
deploying project instructions, and executing an engineering task are separate actions.

`hotzen@2.5.0-rc.1` is a prerelease (Release Candidate). It was unpublished
when these artifacts were prepared. Isolated Linux runtime verification passed.
Native Windows runtime is **NOT VERIFIED**.

For an owner-provided tarball,
install with `npm install --global /absolute/path/to/hotzen-2.5.0-rc.1.tgz`, then
run `hotzen --version`. This installs the existing CLI entry point and requires
no access to the private source repository. Registry commands are conditional
on publication of that exact version; no public bootstrap URL is approved.

Existing `core` / `agent-hub-init` commands, arguments and exit codes remain
compatible. The local installers also retain `agent-hub`. No memory, runtime
configuration, SQLite, receipt, sandbox or `.agents/` path is renamed for branding.
For release export restrictions see [HOTZEN distribution](docs/HOTZEN_DISTRIBUTION.md).

## Prerequisites

- **Node.js 22.13.0 or later in the 22.x line, or 23.4.0 and later**
  (`^22.13.0 || >=23.4.0`). Core uses built-in `node:sqlite`, `DatabaseSync`,
  its `readOnly` option, prepared statements and transactions without requiring an
  experimental enablement flag. Older Node versions can degrade to unavailable
  storage; that is not full support for approval challenges, recording or history.
  SQLite can still emit an experimental warning on supported versions.
- This is a capability-derived minimum, not a claim that every accepted Node
  version has been tested. Record the actual Node version with release evidence.
- Bash for the local macOS/Linux installer; PowerShell for the local Windows
  installer. Python 3 and Git are needed for the optional pre-commit scanner.
  Project verification needs the project's own tools (for example Flutter).
- Provider CLIs, credentials and host integration are needed only for the execution
  route that uses them. They are not installed or configured by this guide's CLI setup.
- npm/npx requires npm and can access the registry and its cache. The legacy private remote stack
  workflow uses Git or download/extraction tools and needs authorized network access.
  Optional local-model weights and executables are not bundled; their absence
  must follow the existing fallback policy, not an implicit download.

## 1. Make the CLI available

From an existing local checkout or an unpacked distribution, choose one method.
Keep that source directory in place: local wrappers delegate to its `cli/index.js`.

**Without installation:**

```sh
node /absolute/path/to/hotzen/cli/index.js --help
```

**Local macOS/Linux wrapper installation:**

```sh
cd /absolute/path/to/hotzen
bash cli/install-mac-linux.sh
```

This writes `hotzen`, `core`, `agent-hub` and `agent-hub-init` under `~/.local/bin`.
Add that directory to your current shell's PATH if the installer reports it missing.
It does not edit shell startup files. An unrelated file, symlink or directory at any alias destination
causes installation to stop before changing any wrapper. Known legacy wrappers
are recognized by their complete template and upgraded without executing them.

**Local Windows wrapper installation:**

```powershell
cd C:\path\to\hotzen
powershell -ExecutionPolicy Bypass -File cli\install-windows.ps1
```

This writes `hotzen.cmd`, `core.cmd`, `agent-hub.cmd` and `agent-hub-init.cmd` under
`$HOME\.local\bin` and adds that directory to the user's persistent PATH if needed.
Open a new terminal afterward. An unrelated existing `core` command in that
installation directory stops installation. Commands elsewhere on PATH can still
shadow these wrappers: use the absolute wrapper path or direct Node invocation
when resolving a collision. No system-wide PATH or package installation is required.

**npm alternative, when using an available registry release:**

`npm install --global hotzen@<published-version>` provides the package's
`hotzen`, `core` and `agent-hub-init` binaries. It writes to the configured npm global prefix.
`npx hotzen@<published-version>` runs the deployer; it does not permanently
install `core`. Do not assume an unpublished candidate is available as `@latest`.

First check the chosen executable with `core --help`, or the direct Node command
above. These instructions are usage guidance, not evidence that installation or a
release candidate has been tested on your system.

## 2. Deploy instructions into the intended project

```sh
cd /absolute/path/to/your/project
core --stack=flutter --bridges=claude --dry-run
# After reviewing the destination and proposed changes:
core --stack=flutter --bridges=claude
```

Use `codex` or `gemini` instead of `claude` for the corresponding host. Explicit
bridge selection selects that bridge; omitting it uses the default bridge set.
Deployment writes governance/configuration files and initializes fresh project
memory; updates preserve existing memory. Differing managed files can produce
backups. Application source changes belong to a separately approved task.
The npm CLI uses bundled local stacks and bridges by default. Missing bundled resources
stop deployment with a reinstall message; they never trigger an implicit private download.
Only explicit `--remote` / `--force-remote` requests use the legacy private GitHub route.
The root `install.sh` / `install.ps1` deployers are legacy network-capable paths,
require authorized private access, and are not supported public bootstrap methods. These
root deployers do not install a persistent `core` command. For a single consistent
first-use route on either platform, use the Node CLI and local wrapper steps above.

**Hooks are opt-in.** Deployment can copy the hook and scanner files, but copying
is not activation. For the Node CLI, `--install-hooks` requests configuration of
`core.hooksPath`; an existing custom hooks path is preserved unless
`--force-hooks` is explicitly selected. That override changes Git configuration
and must be intentional. The local wrapper installers do not configure Git hooks.
Do not infer identical flags or behavior for the separate legacy PowerShell deployer.

## 3. Choose an execution route

Read the deployed `AGENTS.md`, `STACK_RULES.md` and host bridge first:
[Codex](core/bridges/CODEX.md), [Antigravity](core/bridges/GEMINI.md),
[Claude](core/bridges/CLAUDE.md). The bridge is the authoritative detailed workflow.

**Native / Unmanaged:** the selected host edits the approved files. Start with an
exact task goal, file scope, acceptance criteria and `fileOperations` (including
`[]` when no moves/deletes are planned). Codex planning uses
`core plan --provider=codex`; Claude and Antigravity use
`core plan --native --host=claude` or `--host=antigravity`. Supply the structured
`--task-json`, matching `--files`, `--json` and `--save-bundle` as shown in the bridge.
Display the complete returned Plan and obtain fresh direct owner approval before
`core backup --native --plan-file="<bundleFile>"` (also pass the matching `--host`
for Claude/Antigravity). Continue only after `NATIVE_BACKUP_VERIFIED`, then edit
within scope. Do not substitute `core run` for Native execution.

Local targeted checks are Native evidence. Core Verification, Critic and SQLite
recording require separate consent through the visible-terminal or explicitly
opted-in bound challenge flow. Plan approval is not Verification approval. Follow
the host bridge; do not answer an owner's interactive prompt automatically.
Bundles/backups and execution-history SQLite are private workspace state.
Preserve a truthful pending/failure memory state until recording actually succeeds.

**Core-managed:** the Engine executes through the selected supported Provider
adapter. Preserve its saved Plan/Receipt, exact Workspace/scope, CLI owner approval,
Provider budget and applicable Handoff/Safety Floor gates. Use the unchanged Plan
with `core run --plan-file="<bundleFile>"` and the same task/provider inputs.
This can invoke a Provider, change approved project files and persist execution
history. Do not silently switch from this route to Native when a gate fails.

**Host evidence:** Codex, Antigravity and Claude have historical real-execution
evidence for the Tasks actually tested. This does not establish universal host,
OS, Node-version, Provider-adapter or task coverage. Native host execution and a
Core-managed Provider adapter are distinct capabilities.

## Distribution and release evidence

The `package.json` allowlist selects runtime sources and public deployment
resources, including required modules under `core/benchmark`. It excludes private
memory, tasks, SQLite, bundles, backups, caches, consumer sandboxes, test fixtures
and benchmark result data. Credential fields in selected MCP templates must be
empty or environment placeholders; users supply their own credentials separately.

Isolated Linux verification passed for this RC (62 CLI checks and 11 targeted
contract checks). The release tarball was inspected and reconciled with the
public distribution. Native Windows runtime is **NOT VERIFIED**.

Tests and development scripts require the separate complete development source
checkout. They are absent from the distribution. The isolated results do not
establish registry availability or historical Node-version compatibility.
