# 🌐 HOTZEN - Core Directory Architecture

This directory houses the shared multi-bridge deployment artifacts and MCP configurations for HOTZEN — Governed AI Engineering Framework.

## Directory Layout
- **`bridges/`**: Cross-agent bridge instruction files and presets:
  - `GEMINI.md`, `.geminiignore` (Google Gemini / Antigravity)
  - `CLAUDE.md`, `.claude/` (Anthropic Claude Code)
  - `CODEX.md`, `AGENTS.md` (OpenAI Codex / Universal)
  - `CURSOR.md`, `.cursorrules`, `.cursor/rules/` (Cursor IDE)
  - `WINDSURF.md`, `CLINE.md`, `AIDER.md`, and other supported AI engines.
- **`mcp/`**: Model Context Protocol (MCP) server configurations and integrations.

> **Note on Governance Rules & Security:**  
> All primary governance rules, active memory, and Git pre-commit security hooks live canonically in `.agents/`:
> - `.agents/rules/` (27 Governance & Architecture rules)
> - `.agents/memory/` (Working, Session, Project, and Decision memory)
> - `.agents/hooks/` (Git pre-commit hooks)
> - `.agents/security/` (Security scanner)
