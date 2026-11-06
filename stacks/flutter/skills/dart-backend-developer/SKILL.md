---
name: dart-backend-developer
description: Skill and guidelines for Senior Dart & Backend Developer Agent covering Domain/Data layer design, Dio network abstraction, SOLID principles, and Injectable DI.
---

# Skill: Senior Dart & Backend Developer Guidelines

این اسکیل راهنمای تخصصی ایجنت سینیور دارت و بک‌اند برای طراحی لایه‌های هسته (Core)، دامنه‌ (Domain)، داده (Data)، شبکه (Dio) و تزریق وابستگی (DI) است.

---

## 🏛 1. ساختار لایه‌ها و اصول SOLID

### لایه Domain (منطق خالص کسب‌وکار بدون هیچ وابستگی به فلاتر یا فریم‌ورک)
- **Entities**: کلاس‌های داده خالص دارت متصل به `Equatable`.
  ```dart
  class UserEntity extends Equatable {
    final String id;
    final String name;
    const UserEntity({required this.id, required this.name});
    @override
    List<Object?> get props => [id, name];
  }
  ```
- **Repository Interfaces**: کلاس‌های انتزاعی تعریف‌کننده قراردادهای داده.
  ```dart
  abstract class UserRepository {
    Future<Either<Failure, UserEntity>> getUser(String id);
  }
  ```
- **UseCases**: هر UseCase فقط یک کار مشخص را انجام می‌دهد (Single Responsibility Principle).
  ```dart
  @lazySingleton
  class GetUserUseCase implements UseCase<UserEntity, GetUserParams> {
    final UserRepository repository;
    GetUserUseCase(this.repository);

    @override
    Future<Either<Failure, UserEntity>> call(GetUserParams params) async {
      return await repository.getUser(params.id);
    }
  }
  ```

---

## 📡 2. شبکه و لایه Data (Dio & DataSources)

### لایه انتزاعی شبکه (`ApiClient`)
- استفاده از `ApiClient` به عنوان Abstraction برای Dio جهت تست‌پذیری و تعویض‌پذیری.
- تبدیل DioException به Exceptionهای انتزاعی مانند `ServerException` و `NetworkException`.

### DataSources & Models
- **Models**: ارث‌بری از Entity جهت نگهداری متدهای متداول تبدیل `fromJson` و `toJson`.
  ```dart
  class UserModel extends UserEntity {
    const UserModel({required super.id, required super.name});

    factory UserModel.fromJson(Map<String, dynamic> json) {
      return UserModel(
        id: json['id'] as String,
        name: json['name'] as String,
      );
    }

    Map<String, dynamic> toJson() => {'id': id, 'name': name};
  }
  ```
- **DataSource Implementation**:
  ```dart
  abstract class UserRemoteDataSource {
    Future<UserModel> getUser(String id);
  }

  @LazySingleton(as: UserRemoteDataSource)
  class UserRemoteDataSourceImpl implements UserRemoteDataSource {
    final ApiClient apiClient;
    UserRemoteDataSourceImpl(this.apiClient);

    @override
    Future<UserModel> getUser(String id) async {
      final response = await apiClient.get('/users/$id');
      return UserModel.fromJson(response.data);
    }
  }
  ```

---

## 💉 3. تزریق وابستگی (Injectable & GetIt)

- تمام کلاس‌های DataSource، Repository و UseCase باید انوتیشن مناسب داشته باشند:
  - `@lazySingleton` برای اینترفیس‌ها و کلاس‌های لایه Data و Domain.
  - `@injectable` برای کلاس‌های نیازمند نمونه‌سازی جدید یا Bloc/Cubitها.
- پس از اعمال تغییرات در لایه Data/Domain، اجرای دستور build runner اجباری است:
  ```bash
  flutter pub run build_runner build --delete-conflicting-outputs
  ```
