# 🔴 PHP 8.3 & Laravel 11 Enterprise Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Action-Domain-Responder (ADR) / Service-Repository Clean Architecture:
  - `app/Actions/`: Single-responsibility, invokable business logic classes (`CreateOrderAction`).
  - `app/Http/Controllers/`: Thin controllers injecting Actions/Services; zero SQL or raw logic.
  - `app/Http/Requests/`: FormRequest classes handling strict input validation and authorization.
  - `app/Models/`: Eloquent models with typed properties, relationships, and scopes.
  - `app/DTOs/`: Typed Spatie Data Objects or PHP 8.3 readonly DTO classes.
  - `app/Jobs/`: Queued jobs for asynchronous tasks (Redis/Horizon).

## 2. Senior Laravel & PHP 8.3 Best Practices
- **Strict Typing**: Mandate `declare(strict_types=1);` at the top of every PHP file.
- **Constructor Property Promotion**: Use PHP 8.3 readonly classes and constructor property promotion.
- **Eloquent Performance**:
  - Prevent N+1 queries: Enable `Model::preventLazyLoading(!app()->isProduction())`.
  - Always eager-load relationships (`with(['user', 'items'])`).
  - Use database transactions (`DB::transaction`) for multi-step mutations.
- **Security**: Never access `$_POST` or `$_GET` directly; use `$request->validated()` from FormRequests.

## 3. Testing Standards
- Unit and Feature testing with **Pest PHP** or **PHPUnit**.
- Use `RefreshDatabase` trait for database isolation.
