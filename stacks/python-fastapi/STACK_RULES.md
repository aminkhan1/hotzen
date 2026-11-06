# 🐍 Python FastAPI & Clean Architecture Enterprise Stack Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Clean Layered Architecture with strict separation of concerns (Python 3.12+):
  - `src/api/v1/`: Thin API routers (`APIRouter`), dependency injection (`Depends`), HTTP status codes.
  - `src/services/`: Pure domain business logic; zero direct database session references.
  - `src/repositories/`: Data access layer encapsulating SQLAlchemy 2.0 asynchronous queries.
  - `src/models/`: SQLAlchemy ORM models (`Mapped[T]`, `mapped_column`) with typed relationships.
  - `src/schemas/`: Pydantic v2 schemas (`BaseModel`) for request validation and response serialization.
  - `src/core/`: Application settings (`pydantic-settings`), security (JWT), custom exceptions, and logging.

## 2. Senior Python & FastAPI Guidelines
- **Async I/O & Concurrency**: All database operations and external HTTP requests must use `async`/`await`. Never block the asyncio event loop with synchronous calls (e.g. `time.sleep`, `requests`).
- **SQLAlchemy 2.0 Standards**:
  - Always use modern 2.0 syntax (`select(Model).where(...)`). Never use legacy 1.x `session.query()`.
  - Prevent N+1 queries: Mandate `selectinload` or `joinedload` for relationship fetching.
  - Manage database sessions via asynchronous context manager (`async_sessionmaker`).
- **Strict Pydantic v2 Typing**: Use `ConfigDict(from_attributes=True)` and strict field validators (`@field_validator`).
- **Global Error Handling**: Custom exception hierarchy mapped to RFC-7807 problem details in global exception handlers.

## 3. Testing Standards
- Unit testing with **Pytest**, **Pytest-Asyncio**, and **Faker**.
- Integration testing using **Testcontainers-Python** (PostgreSQL) or isolated SQLite in-memory engines.
