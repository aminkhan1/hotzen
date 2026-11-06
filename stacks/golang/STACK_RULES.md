# 🐹 Golang Clean Architecture & High-Concurrency Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Standard Go Project Layout**:
  - `cmd/server/`: `main.go` entry point; wires dependencies and starts HTTP/gRPC servers.
  - `internal/domain/`: Core entities, domain models, error definitions, and repository interfaces.
  - `internal/usecase/` (or `service/`): Business logic orchestrating entities and repositories.
  - `internal/repository/`: GORM / pgx / database implementations.
  - `internal/handler/http/`: Gin / Fiber handlers, request DTOs, validation, and JSON rendering.
  - `pkg/`: Shared, reusable libraries (logging, token generation, crypto).

## 2. Senior Golang Best Practices
- **Explicit Error Handling**: Never ignore errors with `_`. Wrap errors with context using `fmt.Errorf("failed to execute usecase: %w", err)` to preserve stack traces.
- **Context Propagation**: The first parameter of every I/O-bound function must be `ctx context.Context`. Honor context cancellation and deadlines.
- **Goroutine & Concurrency Safety**:
  - Never leak goroutines; always ensure exit conditions with `ctx.Done()` or `sync.WaitGroup`.
  - Guard shared mutable state with `sync.Mutex` / `sync.RWMutex` or use unbuffered channels.
  - Run tests with `-race` flag enabled to detect data races.
- **Nil Safety**: Validate pointers before dereferencing; return typed error constants (`ErrNotFound`, `ErrUnauthorized`).

## 3. Testing Standards
- Unit testing with standard `testing` package and **Testify** (`assert`, `require`).
- Mocking with **Mockery** / **GoMock**.
- Run `go test -race -cover ./...` prior to task sign-off.
