# 🦁 NestJS 10 Enterprise Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Modular Hexagonal Architecture**:
  - `src/<feature>/`: Feature modules (`.module.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`).
  - `src/<feature>/dto/`: DTOs with `class-validator` and `class-transformer` decorators.
  - `src/<feature>/entities/`: Prisma models or TypeORM database entities.
  - `src/common/`: Guards (Auth/RBAC), Interceptors (Logging/Transform), Custom Decorators, and Filters.
  - `src/config/`: Type-safe configuration with `@nestjs/config` and Joi/Zod.

## 2. Senior NestJS & TypeScript Guidelines
- **Global Validation**: Always enable global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- **Dependency Injection**: Use `@Injectable()` and constructor injection; avoid circular dependencies by utilizing forward references (`forwardRef()`) or event dispatching.
- **Global Exception Filter**: Transform unhandled exceptions into uniform Problem Details responses.
- **Swagger Documentation**: Annotate all endpoints with `@ApiTags()`, `@ApiOperation()`, and `@ApiResponse()`.

## 3. Testing Standards
- Unit testing with **Jest** and `@nestjs/testing` (`Test.createTestingModule`).
- End-to-end testing with **Supertest**.
