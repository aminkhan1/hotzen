# ⚔️ Unreal Engine 5.4+ C++20 & Blueprint Hybrid Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Native C++ Base Classes + Blueprint Extensibility (C++20)**:
  - `Source/<Project>/Public/`: Header files (`.h`) with clean `UCLASS()`, `USTRUCT()`, `UENUM()`.
  - `Source/<Project>/Private/`: Implementation files (`.cpp`).
  - `Source/<Project>/GAS/`: Gameplay Ability System (`UGameplayAbility`, `UAttributeSet`, `UGameplayEffect`).
  - `Source/<Project>/Subsystems/`: `UGameInstanceSubsystem` / `UWorldSubsystem` for lifecycle management.
  - `Content/Blueprints/`: Visual-only configurations and asset assignments extending C++ base classes.

## 2. Senior Unreal Engine Guidelines
- **UObject Memory Management**:
  - Always mark UObject member pointers with `UPROPERTY()` to prevent garbage collection crashes.
  - Use `TWeakObjectPtr<T>` for non-owning references to avoid memory leaks.
- **Tick Optimization**: Disable `PrimaryActorTick.bCanEverTick = false` on actors that do not require continuous updates. Use `FTimerManager` or Delegates instead.
- **Gameplay Ability System (GAS)**: Drive all combat attributes, cooldowns, and abilities through native `FGameplayTag` and Gameplay Effects.
- **Enhanced Input**: Use `UEnhancedInputComponent` and Mapping Contexts.

## 3. Testing Standards
- Unit & Functional testing with **Unreal Engine Automation Testing Framework** (`IMPLEMENT_SIMPLE_AUTOMATION_TEST`).
