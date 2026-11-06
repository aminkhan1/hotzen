---
description: Audit recent changes against the Senior Critic Gate (KISS Principle)
---

# Senior Critic Gate Audit (/critic)

Inspect the current unstaged and staged code changes using `git diff` and evaluate against the 7-Question Senior Critic Gate (`.agents/rules/critic_layer.md`):

1. **Requirement Solving**: Does this code genuinely solve the core requirement without shifting the premise?
2. **Architectural Alignment**: Are SOLID principles and clean architectural boundaries (Domain/Data/Presentation) strictly preserved?
3. **Over-Engineering Audit & Generalization Guard**: Were unnecessary abstractions, excessive utility wrappers, or premature optimizations introduced?
   - A single occurrence alone is not sufficient evidence for a reusable abstraction.
   - A new abstraction may still be justified without recurrence when it represents a genuine architectural responsibility, creates a clear ownership boundary, or materially improves separation of concerns or testability.
   - When neither recurrence nor architectural responsibility is demonstrated, prefer the simplest local implementation consistent with the project's existing conventions.
   - Distinguish local decomposition (e.g. private methods) from reusable/generalized abstractions.
4. **Convention Compliance**: Are naming conventions, project patterns, and existing standards faithfully maintained?
5. **Regression & Risk**: Does this change risk introducing hidden side-effects or regressions in other layers?
6. **KISS Simplicity**: Is this the simplest, cleanest, and most maintainable solution possible?
7. **Test Isolation & Zero Side-Effects**: Are tests fully isolated, scoped/targeted, and strictly free of live external side-effects (No Live External Calls)?

Report a pass/fail status with concrete line-level recommendations.
