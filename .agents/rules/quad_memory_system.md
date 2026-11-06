# Quad-Memory System Specification (Working, Session, Project & Decision Memory)

این سند مشخصات فنی «سیستم حافظه ۴ گانه ایجنت‌ها (Quad-Memory System)» را تعریف می‌کند تا تمام ایجنت‌ها با تفکیک دقیق انواع حافظه، از تکرار بحث‌ها یا فرضیات قبلی جلوگیری نمایند.

---

## 🧠 ۱. تفکیک ۴ گانه ساختار حافظه (Quad-Memory Architecture)

```text
Memory Engine
│
├── Working Memory (.agents/memory/working_memory.md)
│   └── استدلال لحظه‌ای، وضعیت فعلی ماشین حالت و زیرتسک‌های در حال اجرا
│
├── Session Memory (.agents/memory/session_memory.md)
│   └── لاگ وقایع سشن جاری، دستورات اجرا شده و نتایج اخیر تست‌ها
│
├── Project Memory (.agents/memory/project_memory.md)
│   └── ساختار پوشه‌ها، الگوهای نام‌گذاری، تم متمرکز و وابستگی‌های پروژه
│
└── Decision Memory (.agents/memory/decision_memory.md)
    └── ثبت تصمیمات کلیدی معماری (ADR)، چرایی تصمیم و شرط تغییر مجدد
```

---

## 🏛 ۲. مشخصات ویژه Decision Memory (ADR Repository)

مهم‌ترین بخش سیستم حافظه، **Decision Memory** است تا ایجنت‌های آینده هرگز بحث‌ها یا تصمیمات قبلی را دوباره تکرار یا تغییر ندهند.

### ساختار هر ثبت تصمیم در `decision_memory.md`:

```markdown
### 📌 Decision: [عنوان تصمیم]
- **Decision**: [تصمیم اتخاذشده - مثلاً استفاده انحصاری از Cubit به جای Bloc]
- **Reason**: [علت فنی - مثلاً حفظ سادگی لایه Presentation و کاهش پیچیدگی Eventها]
- **Do Not Change Unless**: [شرط بازنگری - مثلاً درخواست صریح کاربر برای بازنگری در کل معماری استیت مانیجمانت]
- **Impacted Components**: [بخش‌های متاثر - لایه Presentation، تمامی صفحات UI و Cubitها]
```

---

## 👑 ۳. حکمرانی ۴ نوع حافظه توسط ایجنت مدیر (Lead Agent Memory Governance)

1. **Working Memory**: با هر تغییر در ماشین حالت تسک‌ها بروزرسانی شده و پس از اعتبارسنجی نهایی و تکمیل موفق، به وضعیت آماده (Baseline Ready State) ریست می‌شود.
2. **Session Memory**: لاگ اجرایی سشن جاری را ثبت می‌کند (صرفاً پس از پاس شدن اعتبارسنجی).
3. **Project Memory**: با اضافه شدن پکیج یا ساختار فولدر جدید بروزرسانی می‌شود.
4. **Decision Memory**: با هر تصمیم جدید معماری تکمیل شده و قبل از هر پیشنهادی توسط ایجنت‌ها چک می‌شود.

---

## 🔒 ۴. اصل ایزوله‌سازی کانتکست و مرزهای حافظه پروژه (Project Boundary & Memory Isolation)

1. **تحدید مطلق به مخزن جاری (Repository Scoped)**:
   - فایل‌های حافظه (به‌ویژه `session_memory.md` و `working_memory.md`) منحصراً و اکیداً متعلق به همان مخزن جاری هستند.
2. **ممنوعیت نشت بین‌پروژه‌ای (Zero Cross-Project Contamination)**:
   - هیچ ایجنتی حق ندارد سوابق، اقدامات یا کانتکست پروژه‌ها یا مکالمات خارج از مرز این ریپازیتوری را به حافظه یا پاسخ‌های پروژه تزریق کند.
3. **بهداشت قالب‌های آغازین (Clean Slate Distribution)**:
   - هنگام راه‌اندازی فریم‌ورک در پروژه جدید یا توزیع آن با ابزار CLI، فایل‌های حافظه باید همواره به صورت قالب‌های پاک (Clean Templates) و عاری از هرگونه تاریخچه هاردکدشده توزیع شوند.
