# 🍎 Swift 6 & SwiftUI Modern iOS Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Clean Architecture + Observation Pattern (Swift 6)**:
  - `Views/`: Declarative SwiftUI Views, ViewModifiers, and Design Tokens.
  - `ViewModels/`: Observable classes (`@Observable`) managing UI state.
  - `Domain/`: Models, Business Protocols, and UseCases (Pure Swift).
  - `Data/`:
    - `Repositories/`: Repository implementations.
    - `Network/`: `URLSession` API clients using async/await and typed endpoints.
    - `Storage/`: SwiftData `@Model` classes / CoreData containers.

## 2. Senior Swift 6 & Concurrency Guidelines
- **Strict Concurrency**: Enable complete concurrency checking (`SWIFT_STRICT_CONCURRENCY = complete`).
- **Data-Race Safety**: Use `actor` or `@MainActor` for state mutation to guarantee thread safety.
- **Observation Framework**: Use modern `@Observable` classes instead of legacy `ObservableObject` and `@Published`.
- **NavigationStack**: Use type-safe `NavigationPath` with `navigationDestination(for:)`.

## 3. Testing Standards
- Unit testing with **Swift Testing** (`@Suite`, `@Test`, `#expect`) or **XCTest**.
- Protocol-oriented dependency injection for complete service mocking.
