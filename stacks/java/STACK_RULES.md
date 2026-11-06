# ☕ Java 21 & Spring Boot 3 Enterprise Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Hexagonal / Clean Architecture (Java 21 LTS):
  - `controller/`: REST controllers (`@RestController`), `@Validated`, DTO mapping.
  - `service/`: Pure business logic interfaces and implementations (`@Service`, `@Transactional`).
  - `repository/`: Spring Data JPA / QueryDSL repository interfaces (`@Repository`).
  - `domain/entity/`: JPA entities with Jakarta persistence annotations.
  - `domain/dto/`: Request/Response immutable Java `record`s.
  - `exception/`: Global `@RestControllerAdvice` mapping exceptions to standard RFC-7807 Problem Details.
  - `config/`: Security, OpenApi, Virtual Threads configuration (`@Configuration`).

## 2. Senior Java & Spring Boot Guidelines
- **Constructor Injection**: Never use field `@Autowired`. Use constructor injection with `final` fields (or `@RequiredArgsConstructor`).
- **Java 21 Modern Features**: Use `record` for DTOs and projections; use Pattern Matching for `switch` and Virtual Threads (`spring.threads.virtual.enabled=true`).
- **JPA Performance**:
  - Eliminate N+1 queries with `@EntityGraph` or `JOIN FETCH`.
  - Always set `@Transactional(readOnly = true)` for read queries to disable Hibernate dirty-checking overhead.
- **Validation**: Enforce Jakarta Validation annotations (`@Valid`, `@NotNull`, `@NotBlank`, `@Size`) at controller boundaries.

## 3. Testing Standards
- Unit testing with **JUnit 5**, **Mockito**, and **AssertJ**.
- Sliced testing with `@WebMvcTest` and `@DataJpaTest`.
- Full integration testing with **Testcontainers** (PostgreSQL/MySQL).
