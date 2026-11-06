---
name: flutter-qa-testing
description: Adaptive guide for writing unit tests for domain/business logic and widget testing based on project testing infrastructure.
---

# Skill: Flutter QA & Testing Guidelines

این اسکیل راهنمای نگارش تست‌های خودکار برای فیچرهای فلاتر پیش از تحویل به زیرساخت Verification Engine به صورت تطبیقی (Project-Aware) است.

> 🏛️ **اصل حاکمیت معماری و تستینگ پروژه (Authoritative Testing Invariant):**  
> *"The installed project's existing architecture, dependencies, naming and implementation patterns are authoritative. Core must not infer that an optional technology/example is installed or required."*  
> استراتژی تست، کتابخانه‌های ماک‌سازی (مانند mocktail, mockito یا فیک‌های دستی) و اینترفیس‌های هدف تست باید کاملاً تابع الگوها و زیرساخت موجود در پروژه باشند.

---

## 🎯 قوانین تست‌نویسی
1. **Unit Tests**: نگارش Unit Test برای لاجیک کسب‌وکار، استیت‌ها، UseCaseها و DataSources با استفاده از ابزار تست موجود پروژه (مانند `mockito`, `mocktail` یا Fakes).
2. **Widget Tests**: نگارش Widget Test برای کامپوننت‌های UI در صورتی که زیرساخت تست ویجت در پروژه از قبل پیکربندی شده باشد.
3. **اعتبارسنجی هدفمند**: اجرای تحلیل استاتیک (`flutter analyze` یا `dart analyze`) و تست‌های ماژول‌های متأثر بدون خطای جدید.
