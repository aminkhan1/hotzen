# Execution Policy Engine Specification (Tool & Verification Scope Control)

این سند مشخصات فنی «موتور سیاست‌های اجرا و ابزارهای مجاز (Execution Policy Engine)» را تعریف می‌کند تا ابزارها، ایجنت‌های درگیر و مراحل اعتبارسنجی انحصاراتً بر اساس نوع تغییر (Change Type) و سطح ریسک تعیین شده و از اجرای کارهای سنگین غیرضروری (مانند full scan یا build_runner برای ویرایش‌های جزیی) جلوگیری شود.

---

## 📊 ۱. ماتریکس سیاست‌های اجرا (Execution Policy Matrix)

```text
===================================================================================================================
                                            EXECUTION POLICY MATRIX
===================================================================================================================

[CHANGE TYPE 1: TRIVIAL / PRIVATE SCOPE (RENAME PRIVATE METHOD, FIX PADDING, TYPOS)]
- Risk Level: Low (Tier 1)
- Required Agents: Dedicated Stack Developer (Frontend/Backend)
- Permitted Tools: view_file, replace_file_content, run_command (stack linter)
- Required Verification: Static linter / analyzer only (تست سنگین یا بیلد کامل لازم نیست)

-------------------------------------------------------------------------------------------------------------------

[CHANGE TYPE 2: PRESENTATION / STATE CHANGE (NEW STATE FIELD, COMPONENT UPDATE)]
- Risk Level: Medium (Tier 2)
- Required Agents: UI / Frontend Developer ➔ Senior Code Critic
- Permitted Tools: targeted view_file, replace_file_content, run_command (targeted test runner)
- Required Verification: Targeted component/state test & static linter

-------------------------------------------------------------------------------------------------------------------

[CHANGE TYPE 3: DEPENDENCY INJECTION / PERSISTENCE / SCHEMA CHANGE]
- Risk Level: Medium (Tier 2)
- Required Agents: Backend Developer / Database Developer ➔ Senior Code Critic
- Permitted Tools: edit tools, codegen/build runner, targeted test
- Required Verification: Build / Code generation + targeted test + static linter

-------------------------------------------------------------------------------------------------------------------

[CHANGE TYPE 4: DOMAIN & REPOSITORY CONTRACT CHANGE (ENTITY, USECASE, REPO INTERFACE)]
- Risk Level: High (Tier 3)
- Required Agents: Planner ➔ Backend Dev ➔ UI Dev ➔ Senior Code Critic ➔ QA Tester
- Permitted Tools: symbol graph, impact analyzer, edit tools, full test suite
- Required Verification: Symbol Graph Impact Audit + Build/Codegen + Full Test Suite + static linter

-------------------------------------------------------------------------------------------------------------------

[CHANGE TYPE 5: PACKAGE MANIFEST / CORE ARCHITECTURE CHANGE (NEW DEPENDENCIES, HTTP/CORE WRAPPERS)]
- Risk Level: High (Tier 3)
- Required Agents: Lead Manager Approval ➔ Planner ➔ Backend Dev ➔ Critic ➔ QA Tester
- Permitted Tools: full tool suite + dependency compatibility check
- Required Verification: Dependency Compatibility Check + Full Test Suite + static linter + git diff
===================================================================================================================
```

---

## 🚦 ۲. نگاشت Risk Score به عمق خط لوله (Adaptive Pipeline Depth)

موتور سیاست‌های اجرا عمق خط لوله را مستقیماً بر اساس **Change Risk Score** طبق [change_impact_analyzer.md](.agents/rules/change_impact_analyzer.md) تنظیم می‌نماید:

- **🟢 LOW RISK (Score < 20)** ➔ مسیر سریع: Developer ➔ Targeted Analyze.
- **🟡 MEDIUM RISK (Score 20-45)** ➔ مسیر استاندارد: Developer ➔ Critic ➔ Targeted Tests.
- **🟠 HIGH RISK (Score 46-75)** ➔ مسیر لایه‌ای: Planner ➔ Specialists ➔ Critic ➔ Full Test Suite.
- **🔴 CRITICAL RISK (Score > 75)** ➔ مسیر کامل امنیتی: Lead Approval ➔ Planner ➔ Full Pipeline ➔ Critic ➔ Full Test ➔ Build ➔ Final Audit.
