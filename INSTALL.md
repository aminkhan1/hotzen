# Installation and first use

This guide covers the unpublished HOTZEN **0.0.2** experimental candidate.
The initial experimental release, `hotzen@0.0.1`, is publicly available on npm.
The GitHub distribution repository is public. Native Windows runtime is
**NOT VERIFIED**. Installing the CLI, deploying project instructions, and
executing an engineering task are separate actions.

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
- Bash for the local macOS/Linux installer. Python 3 and Git are needed for
  the optional pre-commit scanner.
  Project verification needs the project's own tools (for example Flutter).
- Provider CLIs, credentials and host integration are needed only for the execution
  route that uses them. They are not installed or configured by this guide's CLI setup.
- npm/npx requires npm and can access the registry and its cache. The legacy private remote stack
  workflow uses Git or download/extraction tools and needs authorized network access.
  Optional local-model weights and executables are not bundled; their absence
  must follow the existing fallback policy, not an implicit download.

## 1. Make the CLI available

### npm and NPX (recommended)

The published 0.0.1 can show Model Switching status on bare `npx hotzen`.
To open its deployer explicitly, run `npx --package=hotzen@0.0.1 -- hotzen`.
The examples below target the 0.0.2 candidate. After npm publication,
`@0.0.2` selects that exact version and `@rc` selects the version tagged
`rc`.

```sh
npx hotzen@0.0.2
npx hotzen@0.0.2 --stack=flutter --bridges=codex
npx hotzen@0.0.2 --help
npx hotzen@rc
```

After 0.0.2 is promoted to `latest`, run `npx hotzen` in the intended project
to open stack detection or selection. NPX does not permanently install the CLI.
Publish future candidates with `--tag=rc`. Move `latest` only after explicit
stable-release approval.

### Global npm installation

After 0.0.2 is promoted to `latest`, install it into the configured npm
global prefix. Plain `hotzen` requires that prefix's executable directory
on `PATH`.

```sh
npm install -g hotzen
hotzen --help
```

### GitHub Release tarball (macOS/Linux)

Use this procedure after both v0.0.2 assets are available on the GitHub
Release. It requires Node.js, npm, curl, and either `shasum` or `sha256sum`.
Download the archive and its separate checksum, verify the archive, then
install the verified bytes into npm's global prefix.

```sh
(
  set -eu
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  cd "$TMP_DIR"
  RELEASE_URL="https://github.com/aminkhan1/hotzen/releases/download/v0.0.2"
  ARCHIVE="hotzen-0.0.2.tgz"

  curl -fL --retry 3 -o "$ARCHIVE" "$RELEASE_URL/$ARCHIVE"
  curl -fL --retry 3 -o "$ARCHIVE.sha256" "$RELEASE_URL/$ARCHIVE.sha256"

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$ARCHIVE.sha256"
  else
    sha256sum -c "$ARCHIVE.sha256"
  fi

  npm install -g "./$ARCHIVE"
  hotzen --help
)
```

The checksum file is specific to the release archive. When switching
versions, download the archive and checksum from the same release.

### Existing checkout or unpacked distribution

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
root deployers do not install a persistent `core` command. Use the public npm
or macOS/Linux tarball instructions above for public installation.

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

## Model Switching in V1

`core switch` reports frozen OFF status. Enabling automatic switching is
blocked. `core switch off [model]` does not select a fixed model. Neither
operation changes saved preferences. The Safety Floor remains active.

## Distribution and release evidence

The `package.json` allowlist selects runtime sources and public deployment
resources, including required modules under `core/benchmark`. It excludes private
memory, tasks, SQLite, bundles, backups, caches, consumer sandboxes, test fixtures
and benchmark result data. Credential fields in selected MCP templates must be
empty or environment placeholders; users supply their own credentials separately.

Isolated Linux verification passed for the initial 0.0.1 release (62 CLI checks and 11 targeted
contract checks). The release tarball was inspected and reconciled with the
public distribution. Native Windows runtime is **NOT VERIFIED**.

Tests and development scripts require the separate complete development source
checkout. They are absent from the distribution. The isolated results do not
establish registry availability or historical Node-version compatibility.
