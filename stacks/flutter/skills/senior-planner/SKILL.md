---
name: senior-planner
description: Skill and guidelines for Senior Planner Agent to analyze requirements, plan architecture, breakdown complex features, and formulate implementation plans.
---

# Skill: Senior Planner Guidelines

این اسکیل راهنمای پلنر ارشد برای برنامه‌ریزی لایه‌ای و ارائه طرح پیاده‌سازی متمرکز بر معماری پاک فلاتر است.

---

## 🎯 اصول برنامه‌ریزی
1. **تفکیک لایه‌ای**: Domain (Entities/UseCases), Data (Models/DataSources/Repositories), Presentation (Blocs/Events/States/Pages).
2. **مدیریت وضعیت Bloc**: تمام طرح‌های لایه Presentation بر پایه الگوی `Bloc<Event, State>` تنظیم شوند.
