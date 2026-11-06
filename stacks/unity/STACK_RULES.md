# 🎮 Unity 6 & C# Enterprise Game Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Component-Driven Clean Architecture & ScriptableObject Architecture:
  - `Assets/Scripts/Core/`: Game Managers, Game States, Dependency Injection (VContainer/Zenject).
  - `Assets/Scripts/Gameplay/`: Player Controllers, Enemy AI (FSM/Behavior Trees), Combat Systems.
  - `Assets/Scripts/Data/`: ScriptableObjects (Item definitions, Game Settings, Audio banks).
  - `Assets/Scripts/Events/`: ScriptableObject Event Channels (Decoupled messaging).
  - `Assets/Scripts/UI/`: UI Toolkit / Canvas Controllers with data-binding.
  - `Assets/Tests/`: EditMode and PlayMode automated test suites.

## 2. Senior Unity Performance & Memory Guidelines
- **Zero Garbage Collection in Update Loops**:
  - Never allocate memory (`new`, LINQ, string concatenation, lambda captures) inside `Update()`, `FixedUpdate()`, or `LateUpdate()`.
  - Cache all `GetComponent<T>()` and `Transform` references in `Awake()` or `OnEnable()`.
  - Use `UnityEngine.Pool.ObjectPool<T>` for high-frequency spawning (projectiles, damage numbers, VFX).
- **Assembly Definitions (`.asmdef`)**: Partition code into modular `.asmdef` files to enforce architectural boundaries and optimize compilation times.
- **Async & Asset Management**: Use Addressables and `UniTask` for async asset loading; avoid blocking `Resources.Load()`.

## 3. Testing Standards
- Unit testing with **Unity Test Framework (UTF)** using NUnit.
- EditMode tests for math, logic, and ScriptableObject data integrity.
- PlayMode tests for physics, input handling, and spawning sequences.
