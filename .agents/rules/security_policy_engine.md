---
id: security.secret-leak-prevention
title: Enterprise Security & Secret Leak Prevention Policy
category: security
severity: critical
enforcement: ENFORCEMENT
verification: pre-commit-hook
approval: HUMAN_APPROVAL
---

# 🔒 Enterprise Security & Secret Leak Prevention Policy

این سند مشخصات فنی «سیاست امنیت سازمانی و پیشگیری از نشت اطلاعات حساس» را برای تمامی ایجنت‌ها تعریف می‌کند.

---

## 🛑 ۱. خط قرمزهای مطلق امنیتی (Zero Secret Leak Policy)

> [!CAUTION]
> هیچ ایجنتی تحت هیچ شرایطی اجازه ندارد موارد زیر را در سورس‌کد، کامنت‌ها، داکیومنت‌ها یا تست‌ها به صورت هاردکد قرار دهد:
> 1. کلیدهای API سرویس‌ها (OpenAI, Anthropic, AWS, Stripe, GitHub Tokens)
> 2. فایل‌های محرمانه (`.env`, `.env.local`, `id_rsa`, `*.pem`, `*.key`)
> 3. پسوردها و رشته‌های اتصال دیتابیس (Connection Strings with Passwords)
> 4. توکن‌های احراز هویت خصوصی و سکرت‌های JWT

---

## 🛡️ ۲. اسکن خودکار پیش از کامیت (Pre-Commit Guard)

قبل از ارائه گزارش به کاربر برای دریافت تایید دستی کامیت:
1. اسکنر امنیتی (`.agents/security/security_scanner.py`) به صورت خودکار تغییرات را بازرسی می‌کند.
2. در صورت کشف هرگونه سکرت، عملیات بلافاصله متوقف و ارور امنیتی اعلام می‌شود.
3. تمامی مقادیر حساس باید از طریق Environment Variables (`process.env`, `os.environ`, `.env`) لود شوند.
