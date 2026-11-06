---
name: senior-critic
description: Skill and guidelines for Senior Code Critic Agent to conduct adversarial code reviews, enforce simplicity, detect over-engineering, and verify architectural alignment.
---

# Skill: Senior Code Critic Guidelines

این اسکیل ممیزی کیفی کدهای فلاتر توسط منتقد ارشد را هدایت می‌کند.

---

## 🔍 چک‌لیست نقد کد
1. آیا معماری پاک (Clean Architecture) تفکیک دقیق لایه‌ها را رعایت کرده است؟
2. آیا مدیریت وضعیت انحصاراتً از الگوی صریح `Bloc` (`Bloc` + `Event` + `State`) پیروی می‌کند؟
3. آیا تزریق وابستگی Injectable و مسیریابی GoRouter بدون هیچ ارجاع مستقیم غیرانتزاعی استفاده شده است؟
4. آیا هیچ لاجیک کسب‌وکاری درون ویجت‌های UI وجود ندارد؟
