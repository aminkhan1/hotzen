# 🟣 C# 12 & .NET 8/9 Enterprise Clean Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Clean Architecture with CQRS (MediatR / FastEndpoints)**:
  - `Domain/`: Core entities, Value Objects, Domain Events, Domain Exceptions (zero external dependencies).
  - `Application/`: Commands, Queries, Handlers, DTOs, FluentValidation validators, Behaviors.
  - `Infrastructure/`: EF Core `DbContext`, Configurations, Repositories, External Services.
  - `Api/`: ASP.NET Core Minimal APIs / Controllers, Middlewares, OpenAPI/Swagger.

## 2. Senior C# 12 & .NET Best Practices
- **Strict Nullability**: Mandate `<Nullable>enable</Nullable>` and treat warnings as errors.
- **Modern C# 12 Features**: Use primary constructors, `record` types for DTOs/Commands/Queries, and Pattern Matching.
- **EF Core Performance**:
  - Always use `AsNoTracking()` for read-only queries.
  - Configure entity mappings with Fluent API (`IEntityTypeConfiguration<T>`); avoid data annotations in domain entities.
  - Use compiled queries and cancellation tokens (`CancellationToken`) in all asynchronous database operations.
- **Error Handling**: Use the Result Pattern (`ErrorOr` / `FluentResults`) or RFC-7807 `ProblemDetails` via Global Exception Handler.

## 3. Testing Standards
- Unit testing with **xUnit**, **FluentAssertions**, and **NSubstitute** / **Moq**.
- Integration testing with `WebApplicationFactory<Program>` and **Testcontainers.NET**.
