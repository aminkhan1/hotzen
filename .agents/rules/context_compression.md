# Context Compression Specification (Stable vs Dynamic Context Partitioning)

این سند مشخصات فنی پیشرفته «فشرده‌سازی کانتکست با تفکیک کانتکست ثابت از پویا (Stable vs Dynamic Context Partitioning)» را تعریف می‌کند تا مصرف توکن‌ها به حداقل ممکن رسیده و فقط بخش‌های متغیر پروژه به‌روزرسانی (Refresh) شوند.

---

## 🏗 ۱. تفکیک ۲ گانه کانتکست (Stable vs Dynamic Context)

```text
Context System
│
├── 🛡 Stable Context (ثابت و تغییرناپذیر - Caching/Static)
│   ├── پشته فناوری و اصول معماری پروژه (Tech Stack Invariants & Clean Architecture)
│   ├── قوانین حاکمیتی سیستم در AGENTS.md
│   └── ساختار Project Memory و ADRها
│
└── ⚡ Dynamic Context (پویا و متغیر - Step-by-Step Refresh)
    ├── وضعیت ماشین حالت تسک فعلی (Current Task & State)
    ├── فایل‌های درگیر در چرخه جاری (Current Files & Range Slices)
    ├── لاگ خطاها و تراک‌های زمان اجرا (Current Errors & Logs)
    ├── گیت دیف و تغییرات کدهای درگیر (Current Diff & Scope)
    ├── نتایج تست‌های اخیر موتور اعتبارسنجی (Current Verification Results)
    ├── ایجنت تخصصی مجری در گام فعلی (Current Active Agent)
    └── سند پیاده‌سازی و دیتاپیلود تحویل (Current Plan & Handoff Payload)
```

---

## 🎯 ۳. بودجه‌بندی و اولویت‌بندی کانتکست (Context Budgeting)

علاوه بر تفکیک Stable vs Dynamic، کانتکست بر اساس بودجه توکن تعیین‌شده (مثلاً ۱۲,۰۰۰ توکن) و ماتریکس اولویت‌بندی طبق [context_engine.md](.agents/rules/context_engine.md) مدیریت می‌شود:

- `Priority 100` (فایل اصلی) ➔ `Priority 90` (وابستگی مستقیم) ➔ `Priority 80` (وابسته‌های مستقیم) ➔ `Priority 70` (تست‌ها) ➔ `Priority 50` (معماری) ➔ `Priority 20` (بخش‌های نامرتبط).
- **در صورت تجاوز از بودجه توکن**: هرس خودمختار کانتکست از اولویت‌های پایین به بالا (`Priority 20` ➔ `Priority 50`).
