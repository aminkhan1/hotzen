# Task Routing & Agent Selection Engine Specification
## Minimum Viable Team (MVT) & Dynamic Pipeline Architecture

این سند مشخصات فنی «موتور مسیریابی تسک و انتخاب پویای ایجنت‌ها (Task Routing & Agent Selection Engine)» را تعریف می‌کند. هدف اصلی این موتور جلوگیری از فعال‌سازی کورکورانه تمام ایجنت‌ها و تضمین اصل **حداقل تیم لازم (Minimum Viable Team - MVT)** بر اساس تحلیل چندبعدی تسک است.

---

## 🎯 ۱. اصل بنیادین: حداقل تیم لازم (Minimum Viable Team)
> **قانون طلایی**: هیچ تسکی نباید به تمام ایجنت‌ها واگذار شود مگر اینکه تغییر کلان معماری (Tier 3) رخ داده باشد. Lead Agent موظف است قبل از شروع هر عملیات، کمترین تعداد ایجنت متخصص مورد نیاز را شناسایی و پایپ‌لاین اجرایی را متناسب با آن پیکربندی کند.

---

## 🔄 ۲. خط لوله تصمیم‌گیری مسیریابی (Routing Decision Pipeline)

قبل از اجرای هر تسک، Lead Agent این خط لوله ۶ مرحله‌ای را طی می‌کند:

```mermaid
graph TD
    T[ورودی Task] --> RA[۱. Requirement Analysis<br>تحلیل نیازمندی و شناسایی لایه‌ها]
    RA --> RskA[۲. Risk Assessment<br>محاسبه نمره ریسک Risk Score]
    RskA --> CC[۳. Change Classification<br>دسته‌بندی نوع تغییر Change Type 1-5]
    CC --> CD[۴. Capability Detection<br>تحلیل ۱۲ بُعد اثرگذاری]
    CD --> AS[۵. Agent Selection (MVT)<br>انتخاب حداقل ایجنت‌های مجاز]
    AS --> EP[۶. Execution Pipeline<br>تولید routing_decision.json و شروع مسیر]
```

---

## 📊 ۳. ماتریس ۱۲ بُعد تحلیل و اثرگذاری (12-Factor Impact Matrix)

Lead Agent پیش از گزینش ایجنت‌ها، وضعیت ۱۲ بُعد زیر را ارزیابی و استخراج می‌کند:

| # | بُعد ارزیابی (Dimension) | توضیحات و دامنه بررسی | ایجنت‌های مشمول در صورت مثبت بودن |
| :-: | :--- | :--- | :--- |
| **۱** | **Task Type** | نوع کار (UI Fix, API Integration, DB Migration, Refactor, Core Change) | تعیین‌کننده الگوی اولیه مسیر |
| **۲** | **Affected Layers** | لایه‌های درگیر (`presentation/ui` / `domain` / `data` / `core`) | UIDev (UI) / BackendDev (Domain/Data) |
| **۳** | **Affected Features** | فیچرهای متأثر و بررسی ایزوله‌سازی حریم فیچر | محدودسازی دامنه تغییرات |
| **۴** | **Risk Level** | سطح ریسک بر اساس Risk Score (🟢 Low, 🟡 Medium, 🟠 High, 🔴 Critical) | تعیین الزام حضور Critic و QA |
| **۵** | **Architectural Impact** | تغییر در Contracts، UseCaseها یا تزریق وابستگی (DI) | Senior Planner + Lead Manager |
| **۶** | **Security Impact** | مدیریت توکن، ذخیره‌سازی امن سکرت‌ها، لاگ داده‌های حساس و PII | BackendDev + Security Audit |
| **۷** | **Performance Impact** | بهینه‌سازی رندرینگ، نشت حافظه و مصرف منابع سیستم | UIDev / BackendDev + Performance Audit |
| **۸** | **Database Impact** | تغییر در جداول/کالکشن‌ها، اسکیمای دیتابیس و کش آفلاین | Senior Database Developer |
| **۹** | **UI/UX Impact** | تغییر در تم، کامپوننت‌ها، ابعاد ریسپانسیو و اسکلت صفحه | Senior UI / Frontend Developer |
| **۱۰** | **Localization Impact** | افزودن کلیدهای ترجمه (i18n: `.json`, `.arb`, `.po`) و سازگاری با RTL/LTR | UIDev / Localization Spec |
| **۱۱** | **Testing Requirements** | نوع تست الزامی (Static Linter / Targeted Unit / Component / Full Suite) | QA Tester + Verification Engine |
| **۱۲** | **Required Capabilities** | مهارت‌های سیستمی مورد نیاز استک (مثل `codegen`, `api_client`) | فعال‌سازی اختصاصی اسکیل‌ها |

---

## 🚦 ۴. الگوهای مسیرهای اجرایی استاندارد (Archetype Execution Routes)

بر اساس خروجی ماتریس ۱۲ بعدی، Lead Agent تسک را به یکی از الگوهای بهینه‌شده زیر هدایت می‌کند:

```text
===================================================================================================
                                ROUTING ARCHETYPES & MVT ALLOCATION
===================================================================================================

[ROUTE A: UI-ONLY & STYLING FIX]
- Trigger: تغییرات صرفاً ظاهری، اصلاح پدینگ، تغییر رنگ در تم، اصلاح تایپوگرافی بدون تغییر استیت
- MVT Team: UI Developer ➔ Senior Code Critic ➔ Verification Engine (Static Linter)
- Excluded: Planner, BackendDev, DBDev, QA Tester
- Latency / Token Efficiency: حداقل مصرف کانتکست با حذف ایجنت‌ها و اسکیل‌های غیرمرتبط


---------------------------------------------------------------------------------------------------

[ROUTE B: STATE MANAGEMENT & PRESENTATION LOGIC]
- Trigger: افزودن فیلد/اکشن استیت جدید، بازتاب وضعیت در کامپوننت‌های UI
- MVT Team: UI / State Developer ➔ Senior Code Critic ➔ QA Tester (Component/State Test) ➔ Verification Engine
- Excluded: Planner, DBDev, BackendDev

---------------------------------------------------------------------------------------------------

[ROUTE C: DATA LAYER & NETWORK INTEGRATION]
- Trigger: اتصال به اندپوینت جدید، ساخت DTO/Model، آپدیت RemoteDataSource و Repository
- MVT Team: Backend Developer ➔ Senior Code Critic ➔ QA Tester (Unit Test) ➔ Verification Engine
- Excluded: UI Developer, DBDev

---------------------------------------------------------------------------------------------------

[ROUTE D: LOCAL DATABASE & OFFLINE CACHE]
- Trigger: ایجاد کش محلی، تغییر Schema دیتابیس لوکال، ماک‌سازی دیتابیس
- MVT Team: DB Developer ➔ Backend Developer ➔ Senior Code Critic ➔ QA Tester ➔ Verification Engine
- Excluded: UI Developer

---------------------------------------------------------------------------------------------------

[ROUTE E: FULL-STACK FEATURE / CROSS-LAYER]
- Trigger: فیچر کاملاً جدید از دیتابیس تا UI، نیازمند معماری کامل
- MVT Team: Lead ➔ Senior Planner ➔ BackendDev + DBDev ➔ Senior Code Critic ➔ UIDev ➔ QA ➔ Lead Review
- Excluded: هیچ‌کدام (تیم کامل)
===================================================================================================
```

---

## 📝 ۵. ساختار رسمی سند تصمیم‌گیری مسیریابی (`routing_decision.json`)

قبل از شروع کار، نتیجه این تحلیل توسط Lead Agent در دایرکتوری `.agents/tasks/<TASK_ID>/routing_decision.json` و همچنین در [working_memory.md](.agents/memory/working_memory.md) ثبت می‌گردد:

```json
{
  "taskId": "TASK-UI-002",
  "routeArchetype": "ROUTE A: UI-ONLY & STYLING FIX",
  "riskLevel": "LOW",
  "changeType": "CHANGE_TYPE_1",
  "impactAnalysis": {
    "taskType": "UI Refactor",
    "affectedLayers": ["presentation"],
    "affectedFeatures": ["cart"],
    "architecturalImpact": false,
    "securityImpact": false,
    "performanceImpact": false,
    "databaseImpact": false,
    "uiUxImpact": true,
    "localizationImpact": false,
    "testingRequirement": "STATIC_ANALYZE_ONLY"
  },
  "minimumViableTeam": [
    "Senior UI Developer",
    "Senior Code Critic",
    "Verification Engine"
  ],
  "excludedAgents": [
    "Senior Planner",
    "Senior Backend Developer",
    "Senior Database Developer",
    "Senior QA Tester"
  ],
  "executionPipeline": [
    "LeadManager.dispatch(UIDev)",
    "UIDev.implement()",
    "Critic.review()",
    "VerificationEngine.analyze()",
    "LeadManager.finalize()"
  ]
}
```
