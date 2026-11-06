---
description: Draft a surgical implementation plan for the specified task
---

# Senior Planner Protocol (/plan)

Create a phased, architectural implementation plan for:
Task description: $ARGUMENTS

Follow these guidelines:
1. State the objective and technical context clearly.
2. Break the implementation into minimal, testable increments (MVT).
3. Specify which existing files will be modified and which new files will be created.
4. Define acceptance criteria and targeted verification test commands (with zero live external side-effects).
5. Adhere to Clean Architecture and strict separation of concerns.
6. Write the resulting structured plan directly into `implementation_plan.md` in the workspace root.
7. Prune exploratory search logs; produce a lean, self-contained contract ready for immediate Coder consumption without carried-over discovery overhead.
8. Generalization Guard: A single occurrence alone is not sufficient evidence for a reusable abstraction. Do not plan generic helpers, base classes, or wrappers for one-off patterns unless demonstrating a genuine architectural responsibility, clear ownership boundary, or material improvement to testability/SoC per `critic_layer.md`. Prefer simple local implementations (e.g. private methods).

