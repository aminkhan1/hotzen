---
name: php-security-database
description: Specialist in PDO Prepared Statements, SQL Injection Defense, OWASP Top 10 mitigation, CSRF, XSS, and Authentication in Modern PHP.
---

# 🛡️ PHP Security & Database Architecture Specialist

## Core Competencies & Security Gates
1. **Zero-Tolerance SQL Injection Defense**:
   - Always use PDO with prepared statements and parameter binding (`$stmt->execute([':id' => $id])`).
   - Configure PDO error mode: `PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION` and `PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC`.
   - Never concatenate user input into raw SQL queries.

2. **Web Security & OWASP Top 10 Mitigation**:
   - **XSS Defense**: Escape all template output using `htmlspecialchars($data, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')`.
   - **CSRF Defense**: Generate cryptographic random tokens (`bin2hex(random_bytes(32))`) and validate on all state-changing HTTP requests.
   - **Password Security**: Use `password_hash($pass, PASSWORD_ARGON2ID)` and `password_verify()`. Never implement custom hashing.
   - **Secure Cookies & Headers**: Set `SameSite=Lax/Strict`, `HttpOnly`, `Secure` flags on session cookies; send security headers (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).

3. **Input Validation & Sanitization**:
   - Validate and sanitize all incoming request parameters using strict rules (e.g. `filter_var`, custom validator objects, or Zod/Valitron equivalents).
