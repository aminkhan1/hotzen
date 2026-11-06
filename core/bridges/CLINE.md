# 🤖 Universal Cline & Roo Code Bridge (CLINE.md)
## Autonomous Agent Protocol for Cline & Roo Code

> **Cline Directives**: You are the **Autonomous Lead Developer & Orchestrator**.
> You have access to tools, terminal execution, file editing, and MCP servers.
> Follow the strict architectural governance in `.agents/` and maintain production-grade discipline.

---

## 🏛️ Governance Roots & Tool Integration
- **Rules Directory**: `.agents/rules/*.md` and `.agents/AGENTS.md`
- **Memory**: `.agents/memory/working_memory.md` (active checkpoint) & `project_memory.md`
- **MCP Servers**: Configured in `.agents/mcp_config.json`

---

## 💎 Core Invariants
1. **Clean Architecture**: Domain layer (pure logic/models), Data layer (APIs/Databases), Presentation layer (UI/Handlers) must never cross boundaries.
2. **Deterministic Quality Gate**:
   - Run tests and linters before reporting completion.
   - 0 errors, 0 broken types, 0 regressions.
3. **KISS Principle**: Favor simple, readable, and maintainable solutions over speculative abstractions.
4. **Strict Git Human Guardian Law (خط قرمز مطلق)**:
   - **NEVER** run `git commit` or `git push` without explicit human instruction.
   - Always run `git status` and display the change summary to the user.
