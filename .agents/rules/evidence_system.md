# Evidence-Based Reasoning System Specification (3-Level Evidence Tiers)

این سند مشخصات فنی «سیستم استدلال سطح‌بندی‌شده مستند به شواهد (3-Level Evidence System)» را تعریف می‌کند تا از گمانه‌زنی مبهم متنی جلوگیری شده و در عین حال سرعت ایجنت‌ها با عدم اجبار بی‌مورد شماره خطوط برای کارهای ساده، حفظ گردد.

---

## 📊 ۱. سطوح ۳ گانه ارائه شواهد (3-Level Evidence Tiers)

```text
================================================================================
                     EVIDENCE LEVEL TAXONOMY
================================================================================

[LEVEL 1 — LIGHTWEIGHT (LOW RISK / ROUTINE CHECKS)]
- کاربرد: تغییرات جزیی UI، ویرایش‌های ساده، افزودن فیلد در استیت
- ساختار: ارجاع ساده به اسم نماد یا نام فایل
- مثال:
  Evidence: AuthController ➔ AuthenticateUserUseCase

--------------------------------------------------------------------------------

[LEVEL 2 — TRACE (MEDIUM RISK / ARCHITECTURE CHANGES)]
- کاربرد: افزودن فیچر جدید در چند لایه، تغییر در اینترفیس‌ها یا Repositories
- ساختار: نام فایل + اسم نماد + زنجیره فراخوانی/وابستگی با شماره خطوط
- مثال:
  Evidence:
  auth_view:L24 (AuthModal / ViewComponent)
  └── auth_controller:L15 (useAuth / AuthController)
      └── auth_usecase:L12 (AuthenticateUser)
          └── auth_repository:L8 (IAuthRepository)

--------------------------------------------------------------------------------

[LEVEL 3 — FULL EVIDENCE (HIGH RISK / CRITICAL / SECURITY / BUG FIXES)]
- کاربرد: رفع خطاهای شکست تست، تغییرات کلان معماری، منطق‌های حساس و احراز هویت
- ساختار: شماره خط دقیق + خروجی کامل ترمینال/تست هدفمند + اسنیپت کد مربوطه
- اصل ایزوله‌سازی: شواهد تست باید منحصراً از اجرای هدفمند (Targeted) و کاملاً ایزوله (بدون تماس‌های زنده خارجی) استخراج شوند.
- مثال:
  Evidence:
  1. Exception trace in http_client:L45 (NetworkException wrapping)
  2. Terminal log: "targeted test failed at test/features/auth/... line #18"
  3. Exact code snippet inspection at line L40-L50
================================================================================
```

---

## 🚫 ۲. ممنوعیت گمانه‌زنی مبهم بدون شواهد

صرف‌نظر از سطح شواهد (Level 1, 2, 3)، استفاده از عبارات مبهم زیر همچنان ممنوع است:
- ❌ «فکر می‌کنم ارور مال فلان‌جاست...»
- ❌ «احتمالاً فریم‌ورک مشکل دارد...»
- ❌ «شاید لاجیک اشتباه باشد...»

به جای آن، ایجنت بر اساس سطح ریسک تسک، شواهد متناسب Level 1 یا Level 2 یا Level 3 ارائه می‌دهد.
