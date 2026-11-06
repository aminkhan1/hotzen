# 🧠 Python AI/ML, RAG & Agentic Workflows Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Modular AI/ML & Agentic Project Layout**:
  - `src/agents/`: Autonomous agent definitions, state graphs (LangGraph/CrewAI), and prompt templates.
  - `src/rag/`:
    - `embeddings/`: Embedding models and tokenizers (HuggingFace / OpenAI).
    - `retrieval/`: Hybrid search, vector stores (`pgvector`, Qdrant, Chroma), rerankers (Cohere/CrossEncoder).
    - `chunking/`: Semantic and recursive text splitters.
  - `src/models/`: PyTorch neural networks, fine-tuning scripts (LoRA/PEFT), and ONNX export pipelines.
  - `src/tools/`: Type-safe custom agent tools with Pydantic input schemas.
  - `src/evaluation/`: Ragas / TruLens automated evaluation benchmarks.

## 2. Senior AI/ML & LLM Guidelines
- **Token Optimization & Prompt Engineering**:
  - Enforce structured outputs via Pydantic (`instructor` or OpenAI Structured Outputs); never parse raw text with regex.
  - Implement dynamic context compression to trim irrelevant tokens before calling LLMs.
- **GPU & Memory Management (PyTorch)**:
  - Use `torch.inference_mode()` (or `torch.no_grad()`) during inference.
  - Implement mixed precision (`torch.autocast('cuda', dtype=torch.bfloat16)`).
  - Clear GPU cache on batch completions (`torch.cuda.empty_cache()`).
- **Hallucination Prevention (RAG)**:
  - Guardrails: Implement groundedness validation; verify retrieved context contains source citations before returning answers.

## 3. Testing Standards
- Unit testing with **Pytest** and **VCR.py** (recording and replaying LLM API responses).
- RAG evaluation testing using **Ragas** (Faithfulness, Answer Relevancy, Context Precision).
