# Agent Handoff Protocol Specification (Task-Scoped Directed Handoffs)

این سند مشخصات فنی «پروتکل ساختاریافته تحویل با ساختار دایرکتوری مجزا (Production-Grade Task-Scoped Handoff Architecture)» را تعریف می‌کند تا با حذف فایل اشتراکی واحد، از بروز Race Condition در اجرای موازی ایجنت‌ها جلوگیری شده و تاریخچه دقیق انتقال تسک‌ها حفظ گردد.

---

## 📂 ۱. ساختار دایرکتوری مجزا برای هر تسک (Task Directory Architecture)

برای هر تسک جدید یک پوشه اختصاصی تحت دایرکتوری `.agents/tasks/<TASK_ID>/` ایجاد شده و فایل‌ها به شکل زیر سازمان‌دهی می‌شوند:

```text
.agents/tasks/
    <TASK_ID>/
        ├── task.json          ➔ متادیتا و وضعیت ماشین حالت تسک
        ├── plan.json          ➔ طرح پیاده‌سازی لایه‌ای و سطح ریسک
        ├── requirements.json  ➔ نیازمندی‌های کیفی استخراج‌شده توسط CoreBrain
        ├── allocation.json    ➔ کانفیگ اجرایی تخصیص‌یافته توسط ModelAllocator
        ├── handoffs/          ➔ فایل‌های تحویل جهت‌دار بین ایجنت‌ها
        │   ├── planner-to-backend.json
        │   ├── planner-to-db.json
        │   ├── planner-to-ui.json
        │   ├── backend-to-critic.json
        │   ├── ui-to-critic.json
        │   └── critic-to-qa.json
        ├── evidence/          ➔ گزارش‌های شواهد عینی (Level 1/2/3)
        ├── verification/      ➔ نتایج لایروب و لاگ‌های موتور اعتبارسنجی
        └── artifacts/         ➔ Artifactهای تولیدشده برای تسک
```

---

## 📦 ۲. ساختار payload تحویل جهت‌دار (`<from>-to-<to>.json`)

نمونه فایل تحویل جهت‌دار در مسیر `.agents/tasks/<TASK_ID>/handoffs/planner-to-backend.json`:

```json
{
  "task_id": "TASK-2026-001",
  "from_agent": "senior_planner",
  "to_agent": "senior_backend_developer",
  "change_type": 4,
  "risk_tier": "Tier 3",
  "status": "ready_for_implementation",
  "goal": "افزودن AuthRemoteDataSource و پیاده‌سازی لایه Data",
  "requirements": [
    "Clean Architecture layer separation",
    "Isolated state management"
  ],
  "files_to_modify": [
    "src/features/auth/data/datasources/auth_remote_data_source"
  ],
  "files_to_inspect": [
    "src/core/network/api_client"
  ],
  "constraints": [
    "ثبت قرارداد در کانتینر DI پروژه"
  ],
  "execution_config": {
    "model": "<provider-model-id>",
    "reasoning_effort": "high"
  },
  "acceptance_criteria": [
    "تایید توسط Critic Layer",
    "پاس شدن ۱۰۰٪ سوئیت تست پروژه"
  ]
}
```

> **نکته بودجه کانتکست:** فیلد `execution_config` اختیاری و به صورت مینیمال (کمتر از ۱۰۰ بایت) اضافه می‌شود تا سقف ۵ کیلوبایتی Handoff هرگز نقض نشود. جزئیات کاتالوگ پرووایدرها و استدلال‌های تفصیلی Brain در فایل‌های مجزای تسک (`requirements.json` و `allocation.json`) باقی می‌مانند.

---

## 🛡 ۳. مزایای معماری Production-Grade Handoff

1. **حذف مطلق Race Condition**: ایجنت‌های موازی (Backend, Database, UI/Frontend) روی فایل‌های مجزا در پوشه `handoffs/` می‌نویسند.
2. **سابقه کامل ردیابی (Audit Trail)**: امکان بررسی گام‌به‌گام تاریخچه تحویل اطلاعات بین ایجنت‌ها در طول زمان.
3. **تفکیک شفاف مسئولیت‌ها**: هر ایجنت فایلی را می‌خواند که دقیقا به مقصد او صادر شده است (`to_agent`).

---

## 📉 ۴. رژیم کانتکست و هرس تاریخچه در Handoff (Context Pruning & Token Budget)

جهت تضمین بهینه‌سازی مصرف توکن و پایداری کانتکست:

1. **پرهیز از انتقال لاگ‌های خام (No Raw Exploration Logs)**:
   - فایل‌های handoff نباید شامل خروجی کامل دستورات `find`، `grep`، یا مکالمات طولانی پلنر باشند.
   - تنها فکت‌های استخراج‌شده و آدرس فایل‌های دقیق ذکر می‌شوند.
2. **سقف بودجه کانتکست Handoff (Under 5 KB Budget)**:
   - حجم هر سند تحویل نباید از ۵ کیلوبایت تجاوز کند تا در کانتکست ایجنت بعدی سربار ایجاد نکند.
3. **ایزولاسیون بر اساس نقش (Strict Role Isolation)**:
   - توسعه‌دهنده UI فایل‌های مربوط به Backend Handoff را دریافت نمی‌کند.
   - تستر صرفاً معیارهای پذیرش و شناسه کامپوننت‌های تست را دریافت می‌کند.

