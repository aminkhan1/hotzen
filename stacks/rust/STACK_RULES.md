# 🦀 Rust 2024 & Tokio High-Performance Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Standard Cargo Workspace / Modular Layout**:
  - `src/main.rs` or `src/lib.rs`: Application entry point and module exports.
  - `src/domain/`: Pure domain models, value objects, business errors (`thiserror`), and trait interfaces.
  - `src/usecase/` (or `services/`): Application business logic orchestrating domain traits.
  - `src/infrastructure/`:
    - `repositories/`: Database implementations (SQLx async connection pools).
    - `clients/`: External HTTP/gRPC clients (Reqwest / Tonic).
  - `src/handlers/`: Axum / Actix-web HTTP handlers, request extractors, and response DTOs.
  - `src/config/`: App configuration loaded via `config-rs` with environment overrides.

## 2. Senior Rust Best Practices
- **Ownership & Zero-Cost Abstractions**:
  - Pass references (`&str`, `&[T]`) instead of cloning data (`.clone()`) unless ownership transfer is strictly necessary.
  - Avoid `unsafe` blocks; if unavoidable, document safety invariant with a mandatory `// SAFETY:` comment.
- **Idiomatic Error Handling**:
  - Use `thiserror` for typed domain and infrastructure errors.
  - Use `anyhow::Result` only in application entry points (`main.rs`) and integration tests.
  - Never call `.unwrap()` or `.expect()` in production paths; use `?` operator or pattern matching.
- **Async & Concurrency (Tokio)**:
  - Never block the Tokio async runtime with CPU-heavy loops; offload to `tokio::task::spawn_blocking`.
  - Use `tokio::sync::Mutex` / `RwLock` when holding locks across `.await` points; use `parking_lot` for non-async sections.

## 3. Testing Standards
- Unit testing with `cargo test` and property-based testing with `proptest`.
- Micro-benchmarks with `criterion`.
