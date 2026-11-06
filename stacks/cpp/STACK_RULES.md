# ⚡ Modern C++20/C++23 & CMake Systems Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Standard CMake Modular Layout**:
  - `CMakeLists.txt`: Root project CMake configuration with strict compiler warnings (`-Wall -Wextra -Wpedantic`).
  - `include/<project>/`: Public header files (`.hpp` / `.h`) with clean include guards (`#pragma once`).
  - `src/`: Implementation files (`.cpp`).
  - `tests/`: GoogleTest test suites.
  - `cmake/`: Custom CMake modules and toolchains.

## 2. Senior Modern C++ Best Practices
- **RAII & Memory Management**:
  - Zero raw `new` and `delete`. Always use `std::make_unique<T>()` and `std::make_shared<T>()`.
  - Use `std::weak_ptr<T>` for cyclic reference prevention.
  - Follow the Rule of Zero / Rule of Five for resource-managing classes.
- **Modern C++20 Features**:
  - Use **Concepts** (`template<typename T> requires ...`) to constrain templates with descriptive compiler diagnostics.
  - Use `std::span` and `std::string_view` for non-owning views of memory without allocations.
  - Use `std::jthread` for automatically joining threads on destruction.
- **Const Correctness & Noexcept**:
  - Mark member functions `const` whenever they do not mutate state.
  - Mark move constructors and move assignment operators `noexcept`.

## 3. Testing Standards
- Unit testing with **GoogleTest (GTest / GMock)**.
- Mandatory execution with AddressSanitizer (`-fsanitize=address`) and ThreadSanitizer (`-fsanitize=thread`).
