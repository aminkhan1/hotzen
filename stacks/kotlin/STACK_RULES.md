# 📱 Kotlin 2.0 & Android Jetpack Compose Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Clean Architecture + MVI / MVVM with Unidirectional Data Flow (UDF)**:
  - `presentation/`:
    - `ui/`: Stateless Jetpack Compose Screens and components (`@Composable`).
    - `viewmodel/`: `ViewModel` classes managing immutable `StateFlow<UiState>` and one-time `Channel<UiEvent>`.
  - `domain/`: Pure Kotlin business logic (UseCases, Domain Models, Repository interfaces; zero Android framework imports).
  - `data/`:
    - `repository/`: Repository implementations coordinating local and remote data sources.
    - `local/`: Room DB entities, DAOs with Flow return types, and DataStore preferences.
    - `remote/`: Ktor / Retrofit API services and DTO mappers.
  - `di/`: Dependency injection using Hilt (`@HiltViewModel`, `@Inject`) or Koin.

## 2. Senior Kotlin & Compose Guidelines
- **Stateless Composable Functions**: Elevate state (`@Composable` accepts `UiState` and event lambdas).
- **Minimizing Recompositions**:
  - Annotate immutable models with `@Immutable` / `@Stable`.
  - Use `remember` and `derivedStateOf` for derived values.
- **Coroutines & Structured Concurrency**:
  - Always launch Coroutines in `viewModelScope`.
  - Use `flowWithLifecycle` or `collectAsStateWithLifecycle` in Compose UI to prevent resource consumption in the background.
- **Offline-First**: Local database (Room) is the single source of truth; network responses update Room.

## 3. Testing Standards
- Unit testing with **JUnit 5**, **MockK**, and **Turbine** for Flow assertions.
- UI interaction testing with **ComposeTestRule**.
