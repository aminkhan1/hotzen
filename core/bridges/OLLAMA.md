# 🦙 Universal Ollama & Local LLM Bridge (OLLAMA.md)
## Multi-Agent Protocol for Ollama, vLLM, LM Studio & Local Models

> **Local Agent Directives**: You are the **Lead Agent & Local Engine**.
> Optimized for **VRAM efficiency**, low-latency local inference, and concise output diffs.

---

## 💎 Core Architecture Invariants
1. **Clean Architecture**: Decouple Domain, Data, and Presentation.
2. **Lean Prompting**: Load only the specific skill needed to preserve local context windows.
3. **Type Safety**: Explicit typing, sound null-safety.
4. **Surgical Diff Outputs**: Avoid rewriting full files; output concise replacement blocks or unified diffs.
5. **Git Guardian**: Always require manual user approval before git modifications.
