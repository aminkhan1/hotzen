# 🐘 Modern PHP 8.2+ & PSR Standards Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Modern OOP, Layered / Clean Architecture with strict typing and PSR standards (Zero legacy procedural spaghetti):
  - `src/Domain/`: Pure domain entities, value objects, domain exceptions, and repository interfaces.
  - `src/Application/`: Use cases, DTOs, service classes, command/query handlers.
  - `src/Infrastructure/`: Database repositories (PDO/Doctrine DBAL), external API clients, logger implementations (Monolog PSR-3), caching (Redis PSR-6/PSR-16).
  - `src/Presentation/` (or `Http/`): HTTP Action/Controllers (PSR-15 RequestHandlers), middleware, API response formatters.
  - `config/`: Configuration files returning typed arrays / environment configs (`.env`).
  - `tests/`: Unit and Integration tests (`tests/Unit`, `tests/Integration`) using PHPUnit or Pest.
  - `public/`: Single entry point `index.php` routing requests through front controller.

## 2. Senior PHP 8.2+ Guidelines & Standards
- **Strict Typing Everywhere**: Every single PHP file must start with `declare(strict_types=1);` without exception.
- **Modern PHP Features**:
  - Use `readonly class` or `readonly` properties for immutable DTOs and Value Objects.
  - Use Constructor Property Promotion for dependency injection and entities.
  - Use Enums (Backed Enums `enum Status: string`) instead of string constants.
  - Use `match` expressions instead of legacy `switch`.
  - Use native return types (`never`, `void`, union types `string|int`, intersection types `Countable&Traversable`).
- **PSR Standards Compliance**:
  - PSR-1 & PSR-12: Strict adherence to formatting and naming standards.
  - PSR-4: Strict namespace-to-directory mapping (`App\` -> `src/`).
  - PSR-7 & PSR-15: Standard HTTP message interfaces and request handlers/middlewares.
  - PSR-11: Dependency Injection Container (e.g. PHP-DI, League Container, or lightweight custom DI).

## 3. Database, Security & Testing Standard
- **Zero SQL Injection Risk**: Mandate PDO Prepared Statements with parameterized placeholders for all dynamic SQL queries. Never concatenate SQL strings.
- **Defensive Web Security**:
  - Output Escaping: Mandate `htmlspecialchars($var, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')` for any HTML rendering.
  - CSRF Token verification on all state-altering requests (POST, PUT, DELETE).
  - Password security: Mandate `password_hash()` with `PASSWORD_ARGON2ID` or `PASSWORD_BCRYPT`.
  - Session security: `session.cookie_httponly = 1`, `session.cookie_secure = 1`, `session.use_strict_mode = 1`.
- **Static Analysis & Testing**:
  - Static analysis with **PHPStan** (Level 8 or max) or Psalm.
  - Minimum 80% code coverage on Domain and Application use cases with **PHPUnit** / **Pest**.
  - Code style validation with `phpcs --standard=PSR12`.
