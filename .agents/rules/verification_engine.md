---
id: quality.verification-engine
title: Automated Verification Engine
category: quality
severity: high
enforcement: VALIDATION
verification: test-suite
approval: ADVISORY
---

# Verification Engine Specification (Automated Execution Infrastructure)

این سند مشخصات فنی «موتور اعتبارسنجی (Verification Engine)» را به‌عنوان زیرساخت اجرایی و مستقل پروژه تعریف می‌کند. موتور اعتبارسنجی فاقد لاجیک تصمیم‌گیری است و فقط اجرای عینی و بی‌طرفانه ابزارهای سنجش صحت کد را بر عهده دارد.

---

## 🏗 ۱. تفکیک معماری: QA Agent در برابر Verification Engine

```text
┌────────────────────────────────────────────────────────┐
│                   QA Agent (Decider)                   │
│  - تحلیل اینکه چه تست‌هایی لازم است                    │
│  - طراحی و نگارش سناریوهای Unit Test و Widget Test     │
│  - تعیین لبه‌های خطا (Edge Cases) و ساخت ماک‌ها (Mocks)│
└──────────────────────────┬─────────────────────────────┘
                           │ درخواست اجرای اعتبارسنجی
                           ▼
┌────────────────────────────────────────────────────────┐
│            Verification Engine (Infrastructure)        │
│  - code format (بررسی فرمت استاندارد کدبیس)            │
│  - static analysis / linter (تحلیل استاتیک لینتر استک) │
│  - test suite runner (اجرای سوئیت کامل تست‌ها)         │
│  - targeted tests (اجرای تست‌های هدفمند قطعات متأثر)   │
│  - build / compile verification (بررسی بیلد و تایپ‌چک) │
│  - git diff verification (بررسی عدم دستکاری خارج مرز) │
└────────────────────────────────────────────────────────┘
```

---

## ⚡ ۲. ابزارهای ۶ گانه زیرساخت Verification Engine

1. 🧼 **`code format verification`**:
   - بررسی فرمت کدهای پروژه طبق استانداردهای رسمی پشته (مانند `prettier`, `dart format`, `gofmt`, `ruff format`, `cargo fmt`).
2. 🔍 **`static analysis & lint verification`**:
   - اجرای تحلیل استاتیک کد و تضمین صفر بودن خطاها (0 errors) و هشدارهای مسدودکننده (مانند `npm run lint`, `tsc --noEmit`, `golangci-lint`, `ruff check`, `cargo clippy`, `flutter analyze`).
3. 🧪 **`test suite verification`**:
   - اجرای تست‌های سوئیت اتوماتیک؛ اجرای کورکورانه سوئیت کل پروژه برای تغییرات موضعی اکیداً ممنوع بوده و فقط در تسک‌های Critical یا به درخواست صریح کاربر مجاز است.
4. 🎯 **`targeted tests verification`**:
   - اجرای تست‌های اختصاصی و هدفمند (Scoped) برای فایل‌ها و ماژول‌های تغییریافته شناسایی‌شده از طریق تحلیل تغییرات گیت (`git diff --name-only`).
5. 🛠 **`build & compile verification`**:
   - اعتبارسنجی فرآیند بیلد یا تولید فایل‌های کدهای ژنریتور و تایپ‌چک استک فعال.
6. 🌿 **`git diff verification`**:
   - اعتبارسنجی تغییرات در گیت جهت تضمین عدم دستکاری فایل‌های نامربوط به فیچر و جلوگیری از نشت اطلاعات حساس.

---

## 🛡️ ۳. اصول ۴ گانه حاکمیتی اعتبارسنجی (Verification Invariants)

1. **Targeted & Scoped Verification Only**:
   - ایجنت صرفاً موظف به اجرای تست‌های مرتبط مستقیم با تسک جاری است. اجرای کورکورانه کل سوئیت تست‌های گذشته (Blind Over-Testing) ممنوع است.
2. **Zero External Side-Effects (خط قرمز مطلق)**:
   - تست‌ها و اسکریپت‌ها تحت هیچ شرایطی نباید به سرویس‌های واقعی (ایمیل، پیامک، درگاه پرداخت، وب‌هوک‌های لایو) متصل شوند؛ تمامی درایورها باید Mock، Null یا Log-Only باشند.
3. **Single-Pass Sufficient Verification**:
   - به محض پاس شدن لینتر و تست‌های هدفمند با ۰ خطا و ۰ هشدار مسدودکننده، فرآیند اعتبارسنجی پایان یافته تلقی شده و ایجنت بلافاصله متوقف (STOP) می‌شود.
4. **Test Artifact Lifecycle**:
   - اسکریپت‌های موقت در پوشه `scratch/` باید پیش از اتمام تسک پاکسازی شوند؛ تست‌های ماندگار باید به پوشه استاندارد `test/` با ماک‌های ایزوله منتقل گردند.
5. **Adaptive & Infrastructure-Aware Verification**:
   - اعتبارسنجی متناسب با زیرساخت تست واقعی موجود در پروژه و ماهیت تغییرات انجام می‌شود. در تغییرات صرفاً متنی یا کانفیگ، اجرای سوئیت‌های تست کد بای‌پس می‌شود. الزام به تست‌هایی که زیرساخت آن‌ها در پروژه وجود ندارد ممنوع بوده و وضعیت `SKIPPED` با ذکر علت ثبت می‌شود.

---

## 📊 ۴. خروجی عینی زیرساخت (Objective Pass/Fail Metrics)

موتور اعتبارسنجی تنها یک گزارش سیاه/سفید (Pass/Fail) همراه با متدها و لاگ ارورهای دقیق ارائه می‌دهد تا ایجنت مدیر بر اساس آن برای ترانزیشن به وضعیت `DONE` یا `FAILED` تصمیم‌گیری کند.
