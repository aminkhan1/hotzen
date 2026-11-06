# HOTZEN distribution and public export

HOTZEN — Governed AI Engineering Framework uses package identity
`hotzen@2.5.0-rc.1`. This version is a release candidate. This document is a
release procedure, not publication, sanitation, test or Core governance evidence.

## Compatibility boundary

- `hotzen`, `core` and `agent-hub-init` npm binaries use `cli/index.js`.
  User-local installers additionally retain `agent-hub`.
- Node compatibility remains `^22.13.0 || >=23.4.0`; no dependency or entry-point
  migration is required. Existing arguments, command routing and exit codes remain.
- Keep `.agents/`, its SQLite/configuration/memory files, `.core-plan-bundles`,
  sandbox paths, environment-variable names and `AGENT-CORE-HUB` managed markers.
  These are compatibility identifiers, not presentation branding.
- The Codex adapter recognizes exactly `hotzen` and legacy `agent-hub-init` with
  the existing `core` binary layout. Root/home/repository exclusions, canonical
  workspace checks, Git-less consent, Plan Approval and receipts remain required.
- Local installers recognize complete known wrapper templates without executing
  them. Foreign files, symlinks, directories and Windows command-extension
  collisions cause a refusal before wrapper or PATH updates. Resolve collisions
  manually; do not delete an unrelated command to make installation pass.

## Packaged installation versus remote bootstrap

An owner-provided package can be installed with:

```sh
npm install --global /absolute/path/to/hotzen-2.5.0-rc.1.tgz
hotzen --version
hotzen --help
```

After publication of this exact version, registry alternatives are
`npm install --global hotzen@2.5.0-rc.1` and `npx hotzen@2.5.0-rc.1 --help`.
No publication has been performed or claimed here. Review npm prefix collisions
before installation; local wrapper preflight does not govern npm's own installer.

Normal deployment reads bundled `stacks/`, shared rules and bridges. It does not
need the private GitHub source. Explicit `--remote` / `--force-remote` and standalone legacy bootstrap scripts
retain the private remote route. Missing bundled CLI resources fail locally with
a reinstall message instead of an implicit private download. Such operations require separately authorized access.
No public HOTZEN repository URL or bootstrap endpoint has been approved. Do not
replace private URLs with a guessed public URL. Private repository metadata is
removed from package metadata; legacy bootstrap constants remain separate.

## Clean-history allowlist export

The current approximately **1503-file working copy is not a sanitized public
release**. Never publish, mirror, push, archive wholesale, or copy its Git history.
Never use the working-copy file count as a distribution manifest.

1. Start a new empty export directory outside the original repository. Preserve
   the original repository as read-only. Do not copy `.git`, remotes or history.
2. Generate the actual release tarball with one pinned npm toolchain, offline
   and with lifecycle scripts disabled. Record the toolchain version and tarball
   digest; use its exact contents as the final distribution manifest. Do not
   recover an old ephemeral manifest or treat a remembered count as evidence.
3. Expand the explicit `package.json.files` allowlist, accounting for npm's
   mandatory manifest/license/readme inclusion rules. Review every selected path
   and its bytes before copying; reject symlinks, path escapes and generated
   artifacts. Copy only selected files to the empty export directory.
4. Exclude all development memory, SQLite/WAL files, runtime configuration,
   credentials, `.env*`, private MCP settings, task/approval bundles, local backups,
   sandboxes, benchmark results, caches and dependencies. The selected static
   `.agents` rules/security/model defaults are distinct from private runtime data.
   Review default configuration and every selected file for secrets and private
   identifying content; an allowlist alone does not prove sanitation.
5. Reconcile selected paths and content hashes against the actual release tarball.
   The migration adds `docs/HOTZEN_DISTRIBUTION.md` to the source allowlist.
   Do not force an historical file count by dropping required runtime files.
6. Inspect the tarball's exact manifest, including executable modes and the three
   npm binaries. Compare actual paths, sizes and hashes against the reviewed
   export. Record the pinned npm toolchain and tarball digest with this evidence.
7. Run the focused regression suites in an isolated Docker environment with
   network and provider execution disabled. Include package distribution,
   user-local installer upgrades/collisions, Codex Git-less protection and CLI
   compatibility. Run fixture validation offline; npm pack must use a disposable
   cache. Windows installer runtime requires a separate isolated Windows run.
8. Review the resulting export and manifest with the owner. Only after approval,
   create a fresh public history from the reviewed export. Publishing packages,
   configuring a public remote, pushing or activating bootstrap endpoints each
   requires separate explicit authorization.

## Release verification

Isolated Linux verification passed for this RC. The release tarball has been
inspected against the public distribution. Native Windows runtime is **NOT VERIFIED**.
Tests and development scripts require the separate complete development checkout.
