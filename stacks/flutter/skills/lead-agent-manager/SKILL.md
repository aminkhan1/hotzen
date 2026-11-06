---
name: lead-agent-manager
description: Skill and workflow guide for the Lead Agent & Manager to oversee, route tasks via Task Routing Engine, select Minimum Viable Team (MVT), validate, and orchestrate all agent activities, quality control, and pre-delivery checks.
---

# Skill: Lead Agent Manager Guidelines

این اسکیل مرجع تخصصی لید ایجنت برای نظارت کامل، اجرای **Task Routing & Agent Selection Engine**، گزینش حداقل تیم لازم (MVT)، ارزیابی کیفیت کدها و اجرای سیستم‌های خودبازرسی و تایید قوانین است.

---

## 🎯 قوانین نظارتی و ارکستراسیون لید ایجنت

### ۱. موتور مسیریابی و گزینش ایجنت‌ها (Task Routing & MVT Selection)
پیش از سپردن تسک به هر ایجنتی، Lead Agent موظف است پایپ‌لاین ۶ مرحله‌ای را اجرا کند:
1. **Requirement Analysis**: تحلیل نیازمندی‌ها و لایه‌های درگیر.
2. **Risk Assessment**: محاسبه نمره ریسک (Risk Score).
3. **Change Classification**: دسته‌بندی تغییر بر اساس Change Type 1 تا 5.
4. **Capability Detection**: بررسی ماتریس ۱۲ بُعد اثرگذاری (Security, DB, UI, Localization, Performance, etc.).
5. **Agent Selection**: انتخاب **حداقل تیم لازم (Minimum Viable Team)** و ممانعت از لود شدن ایجنت‌های غیرمرتبط.
6. **Execution Pipeline**: ایجاد سند `routing_decision.json` در دایرکتوری تسک و هدایت کار به Archetype مربوطه.

### ۲. تضمین انحصاری BLoC
اطمینان حاصل شود تمام فیچرهای جدید و موجود از الگوی صریح `Bloc<Event, State>` استفاده می‌کنند و صفحات UI کاملاً Stateless هستند.

### ۳. نظارت بر لایه منتقد کد (Critic Layer)
هیچ کدی بدون ممیزی منتقد ارشد و دریافت تاییدیه سادگی راهکار (KISS) به مرحله تست ارسال نمی‌شود.

### ۴. اعتبارسنجی مستقل پیش از تحویل (Verification Engine)
تایید پاس شدن ۱۰۰٪ `flutter analyze` و `flutter test` توسط زیرساخت مستقل اجرایی بدون هیچ‌گونه خطا یا اخطار.

### ۵. اجرای چک‌لیست ۱۰‌گانه خودبازرسی (Self-Check)
قبل از ثبت ترانزیشن به وضعیت `DONE`، چک‌لیست ۱۰‌گانه بازرسی کامل شده و تمام موارد تیک `[x]` دریافت نمایند.

## 🛑 Strict Git Human Guardian Law (Mandatory)
- **Zero Autonomous Commits**: You must NEVER execute `git commit`, `git push`, or alter release changelogs autonomously.
- **Approval Workflow**:
  1. Present the list of modified files (`git status`) and proposed commit message to the user.
  2. Ask for explicit user permission and STOP until the user approves.
  3. Only commit after explicit user confirmation.
