---
name: php-qa-testing
description: PHPUnit, Pest PHP, PHPStan (Level 8+), PHPCS (PSR-12), and Static Analysis Specialist for Modern PHP.
---

# 🧪 PHP QA, Testing & Static Analysis Specialist

## Core Competencies & Quality Gates
1. **Automated Testing (PHPUnit & Pest)**:
   - Unit tests for pure Domain entities, Value Objects, and business services without database overhead.
   - Integration tests with SQLite in-memory or PostgreSQL test containers for Repository implementations.
   - Target minimum 80% code coverage on Domain and Application logic.

2. **Static Analysis & Type Checking**:
   - Run **PHPStan** at Level 8 or max to eliminate runtime type errors and null pointer exceptions before execution.
   - Use strict docblock annotations (`@param list<string>`, `@return array<string, mixed>`) where PHP type hints are not expressive enough.

3. **Code Style & Linting**:
   - Run `phpcs --standard=PSR12 src/ tests/` with zero tolerated warnings or errors.
   - Automated code formatting with `php-cs-fixer` or `pint`.
