---
description: Run targeted automated verification (linters, static analysis, scoped tests)
---

# Quality Verification Pipeline (/verify)

Execute the targeted verification suite for the project (per `verification_engine.md`, scoped tests are the default; use `--scope=full` only for critical releases or explicit requests):

1. **Static Analysis & Linting**:
   - Run the project linter and type checker on modified files or project (e.g. `npm run lint`, `tsc --noEmit`, `cargo clippy`, `ruff check`, `go vet`, `flutter analyze`).
   - Confirm **0 errors** and 0 unhandled warnings.
2. **Targeted Automated Test Suite**:
   - Run targeted unit tests directly covering the modified files (e.g. `npm test -- <path>`, `pytest <path>`, `go test <package>`).
   - Confirm all targeted tests pass with 100% green status (0 errors, 0 warnings).
   - If `--scope=full` is specified, run the complete test suite.
3. **Repository Cleanliness**:
   - Run `git status` to verify no leftover temp files, caches, or unformatted files exist.
