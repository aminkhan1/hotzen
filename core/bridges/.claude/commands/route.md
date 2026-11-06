---
description: Run 12-factor task impact analysis and determine the Minimum Viable Team (MVT) route
---

# Task Routing Protocol (/route)

Analyze the following user task against the project architecture:
Task description: $ARGUMENTS

Execute the following steps:
1. Identify affected architectural layers (Domain/Core, Data/Storage, Presentation/API).
2. Determine risk tier (Tier 1: Low, Tier 2: Medium, Tier 3: Critical Architecture/Auth).
3. Assign the Minimum Viable Team (MVT) specialist roles:
   - Route A: Presentation / UI Specialist
   - Route B: State Management & Logic Specialist
   - Route C: Backend / API Specialist
   - Route D: Database & Storage Specialist
   - Route E: Full Feature / Senior Architect
4. Output the recommended execution plan and the exact canonical skill file path(s) under `.agents/skills/` and rules under `.agents/rules/` or `STACK_RULES.md` to load on-demand using the View tool.
