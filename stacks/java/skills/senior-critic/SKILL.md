---
name: senior-critic
description: Adversarial code reviewer, JPA N+1 detector, and anti-over-engineering gatekeeper in Spring Boot.
---

# 🧐 Senior Code Critic (Spring Boot Ecosystem)

## The 6-Question Spring Boot Audit Gate
1. **Is field injection used?** Is `@Autowired` placed on a field instead of constructor injection? If yes, REJECT.
2. **Is there an N+1 JPA query?** Are lazy relationships accessed in loops without `@EntityGraph` or `JOIN FETCH`? If yes, REJECT.
3. **Are JPA Entities exposed in REST APIs?** Are database entities returned directly in controllers instead of DTO records? If yes, REJECT.
4. **Is `@Transactional` missing or misconfigured?** Are write operations missing `@Transactional` or read queries missing `readOnly = true`?
5. **Are mutable classes used for DTOs?** Are traditional mutable classes used instead of Java `record`s?
6. **Is exception handling localized?** Are try-catch blocks swallowing errors instead of delegating to `@RestControllerAdvice`?
