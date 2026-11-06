# 🐚 Enterprise Bash 5.2+ & POSIX Shell Automation Rules

## 1. Core Architecture & Folder Hierarchy
- **Standard Modular Shell Script Layout**:
  - `bin/`: User-facing executable scripts (`#!/usr/bin/env bash`).
  - `lib/`: Reusable, sourceable shell function libraries (`logging.sh`, `colors.sh`, `network.sh`).
  - `config/`: Environment configuration files (`.env`, `defaults.conf`).
  - `tests/`: Bats-core automated test suites (`.bats`).

## 2. Senior Bash Best Practices & Safety Flags
- **Mandatory Safety Prelude**: Every bash script MUST start with:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  IFS=$'
	'
  ```
- **Quote Everything**: Always double-quote variables (`"$variable"`, `"${array[@]}"`) to prevent word splitting and globbing.
- **Trap & Cleanup**: Always register cleanup routines for temporary files:
  ```bash
  trap cleanup EXIT INT TERM
  cleanup() { rm -rf "$TMP_DIR"; }
  ```
- **Functions & Local Variables**: All function variables must be declared with `local` (e.g. `local target_file="$1"`).
- **Test Operators**: Always prefer `[[ ... ]]` over `[ ... ]` for enhanced conditional testing.

## 3. Testing Standards
- Automated unit testing with **Bats-core** (Bash Automated Testing System).
- Static analysis with **ShellCheck** (`shellcheck -x script.sh`) with zero warnings.
