# 🟢 Node.js 22 LTS & Modern TypeScript Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Clean Layered Architecture (Native ESM, TypeScript Strict)**:
  - `src/routes/`: Route declarations and Fastify/Express endpoint definitions.
  - `src/controllers/`: Request handling, validation parsing, and status responses.
  - `src/services/`: Pure business logic layer.
  - `src/repositories/`: Database abstraction (Drizzle ORM / Kysely / pg).
  - `src/schemas/`: Zod schemas for runtime request/response validation and TypeScript type inference.
  - `src/middleware/`: Authentication, rate limiting, error handling, correlation IDs.

## 2. Senior Node.js Best Practices
- **Fastify over Express**: Default to Fastify for high-throughput I/O and built-in schema serialization.
- **Strict Validation with Zod**: Infer all types directly from Zod schemas (`type User = z.infer<typeof UserSchema>`).
- **Structured Logging**: Use **Pino** for structured JSON logging with correlation IDs; `console.log` is strictly forbidden.
- **Graceful Shutdown**: Implement clean SIGINT / SIGTERM handlers closing database connections and active HTTP servers.

## 3. Testing Standards
- Unit and integration testing with **Vitest** or **Jest** and **Supertest**.
