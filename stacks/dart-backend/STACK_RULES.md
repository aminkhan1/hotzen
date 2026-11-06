# 🎯 Dart Backend (Serverpod, Dart Frog & Shelf) Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Clean Layered Architecture (Sound Null Safety)**:
  - `endpoints/` or `routes/`: Type-safe Serverpod RPC endpoints or Dart Frog request handlers.
  - `services/`: Pure business logic and domain services.
  - `models/`: Serverpod YAML protocol models (`.spy.yaml`) or immutable Dart data classes.
  - `repositories/`: Database abstraction over PostgreSQL and Redis.

## 2. Senior Dart Backend Best Practices
- **Non-blocking Asynchronous I/O**: Use `Future` and `Stream` effectively; never block isolates with long-running synchronous loops.
- **Code Generation Synchronization**: Keep protocol models synchronized with `serverpod generate` or `build_runner`.
- **Session & Auth Governance**: Enforce strict session authentication and role checks in endpoint handlers.
- **Connection Pools**: Utilize connection pools for database operations.

## 3. Testing Standards
- Unit and integration testing using `package:test`, `serverpod_test`, and `mocktail`.
