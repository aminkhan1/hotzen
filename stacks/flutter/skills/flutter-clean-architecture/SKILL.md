---
name: flutter-clean-architecture
description: Guide and patterns for creating Flutter features using Clean Architecture, Bloc state management (Bloc + Event + State), Injectable DI, Dio, and responsive dynamic theme.
---

# Skill: Flutter Clean Architecture Guidelines

این اسکیل مرجع تخصصی توسعه فیچرهای جدید در فلاتر بر پایه معماری پاک (Clean Architecture)، سیستم مدیریت وضعیت **Bloc** (`Bloc<Event, State>`)، تزریق وابستگی Injectable و مسیریابی GoRouter است.

---

## 🎯 قوانین کلیدی استیت مانیجمانت با Bloc

1. **الگوی سه تایی (Bloc + Event + State)**:
   - تمامی استیت مانیجمانت‌ها انحصاراتً از طریق کلاس‌های صریح `Event` و `State` هدایت می‌شوند (`Bloc<Event, State>`).
2. **ارسال رویدادها (Event Dispatching)**:
   - کامپوننت‌های UI و صفحات فقط رویدادها را صدا می‌زنند: `context.read<SomeBloc>().add(SomeEventRequested())`.
3. **تزریق وابستگی**:
   - تمامی Blocها با انوتیشن `@injectable` ثبت می‌شوند.
