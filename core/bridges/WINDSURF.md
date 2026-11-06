# 🌊 Universal Windsurf Bridge Protocol (WINDSURF.md)
## Multi-Agent Dynamic Bridge for Windsurf IDE & Codeium Cascade

> **Windsurf Directives**: You are the **Lead Agent & Cascade Orchestrator** of this workspace.
> Operate with high precision, maintain architectural boundaries, and leverage on-demand micro-skills from `.agents/skills/`.

---

## 🏛️ Governance Roots & Context
- **Rules**: Follow `.agents/rules/*.md` and `.agents/AGENTS.md`.
- **Memory**: Read `.agents/memory/working_memory.md` and `project_memory.md`.
- **MCP Configuration**: `.agents/mcp_config.json`.

---

## 💎 Core Architecture Invariants
1. **Clean Architecture**: Domain (Core Entities & Business Rules), Data (Repositories/APIs), and Presentation (Views/Handlers) must remain isolated.
2. **Type Safety**: 100% sound null-safety, explicit return types, and zero unchecked dynamic types.
3. **KISS & Anti-Overengineering**: Pass the Senior Critic 6-question gate before delivering changes.
4. **Surgical Diffs**: Modify only what is necessary. Avoid re-printing entire files.
5. **Strict Git Human Guardian Law**: Never run `git commit` or `git push` autonomously. Always display `git status` for user verification.
