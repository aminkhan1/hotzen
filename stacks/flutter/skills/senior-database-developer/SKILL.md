---
name: senior-database-developer
description: Adaptive guide for Senior Database Developer Agent covering project-specific local storage (GetStorage, SharedPreferences, Hive, Isar, Drift, Sqflite), caching, and offline-first strategies.
---

# Skill: Senior Database Developer Agent Guidelines

این اسکیل راهنمای تخصصی ایجنت دیتابیس (Senior Database Developer Agent) برای طراحی لایه‌های ذخیره‌سازی محلی هماهنگ با ابزار موجود پروژه (مانند `get_storage`, `shared_preferences`, `Hive`, `Isar`, `Drift`, `Sqflite`)، ماک‌سازی دیتابیس، کشینگ Offline-First و تزریق وابستگی است.

> 🏛️ **اصل حاکمیت معماری و ذخیره‌سازی پروژه (Authoritative Persistence Invariant):**  
> *"The installed project's existing architecture, dependencies, naming and implementation patterns are authoritative. Core must not infer that an optional technology/example is installed or required."*  
> راهکار و پکیج‌های ذخیره‌سازی محلی موجود در پروژه همواره مرجع قطعی هستند. نمونه‌های ذکرشده (مانند Hive، Drift، Sqflite یا GetStorage) صرفاً به عنوان الگوهای مرجع و دانش اختیاری است و هرگز نباید به عنوان ساختار اجباری پروژه تلقی شود.

---

## 🎯 وظایف اصلی ایجنت دیتابیس

1. **طراحی Local DataSources**:
   - ایجاد اینترفیس انتزاعی و کلاس پیاده‌سازی متناسب با راهکار ذخیره‌سازی پروژه.
2. **ماک‌سازی لایه ذخیره‌سازی برای تست‌ها**:
   - ایجاد ماک‌ها، فیک‌ها یا تست‌دابل‌ها با استفاده از زیرساخت تست پروژه (مانند `mocktail`، `mockito` یا پیاده‌سازی فیک داخلی).

---

## 🗄 1. معماری دیتابیس و ذخیره‌سازی محلی

- **شناسایی ابزار دیتابیس موجود در پروژه**:
  - **Key-Value / Lightweight**: مانند `get_storage` یا `shared_preferences` برای تنظیمات، توکن‌ها و کش‌های سبک کلید-مقدار.
  - **Document / NoSQL**: مانند `Hive` یا `Isar` برای اشیاء و اسناد محلی سریع.
  - **Relational / SQL**: مانند `Drift` یا `Sqflite` برای مدل‌های داده‌ای رابطه‌ای با کوئری‌های SQL.
- **اصل Abstraction در لایه داده**:
  - تعریف اینترفیس `LocalDataSource` مستقل از پیاده‌سازی مستقیم دیتابیس، تا لاجیک دامنه و ریپازیتوری‌ها به کتابخانه ذخیره‌سازی وابسته نباشند.

---

## 🛠 2. الگوی پیاده‌سازی LocalDataSource (نمونه مرجع انتزاعی)

```dart
abstract class UserLocalDataSource {
  Future<void> cacheUser(UserModel user);
  Future<UserModel?> getCachedUser();
  Future<void> clearCache();
}

// نمونه پیاده‌سازی: کلاینت داخلی متناسب با پکیج پروژه (GetStorage / SharedPreferences / Hive Box / SQLite Database) تزریق می‌شود
class UserLocalDataSourceImpl implements UserLocalDataSource {
  final dynamic storageClient; // به عنوان مثال: GetStorage(), SharedPreferences, Box<UserModel> یا DatabaseExecutor

  UserLocalDataSourceImpl(this.storageClient);

  @override
  Future<void> cacheUser(UserModel user) async {
    // پیاده‌سازی بر اساس متد کلاینت پروژه (مثلاً storageClient.write('user', user.toJson()))
  }

  @override
  Future<UserModel?> getCachedUser() async {
    // خواندن بر اساس متد کلاینت پروژه (مثلاً storageClient.read('user'))
    return null;
  }

  @override
  Future<void> clearCache() async {
    // پاکسازی بر اساس متد کلاینت پروژه
  }
}
```

---

## ⚡ 3. استراتژی‌های آفلاین و کشینگ (Offline-First Sync Strategy)

1. **Cache-First**: ابتدا داده را از دیتابیس محلی بخوانید، سپس درخواست شبکه ارسال کرده و دیتابیس محلی را بروزرسانی کنید.
2. **Network-First with Local Fallback**: درخواست به API ارسال شود؛ در صورت عدم دسترسی اینترنت (`NetworkException`)، داده از دیتابیس محلی خوانده شود.
3. **تزریق وابستگی (DI)**: کلاینت یا ماژول ذخیره‌سازی محلی بر اساس الگوی DI مستقر در پروژه (مانند `get_it`، `provider`، `riverpod` یا تزریق دستی سازنده) در لایه‌ها تزریق می‌شود.
