# 🐍 Godot Engine 4 Typed GDScript 2.0 Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Strict Typed Node Composition & Finite State Machines**:
  - `scenes/`: Componentized scene hierarchies (`.tscn`).
  - `scripts/characters/`: Player and enemy logic using `CharacterBody2D` / `CharacterBody3D`.
  - `scripts/fsm/`: State Machine nodes (`State`, `StateMachine`).
  - `resources/`: Custom Resource files (`.tres`) with `class_name`.
  - `autoload/`: Global singletons (Event Bus, SaveManager, AudioPlayer).

## 2. Senior GDScript 2.0 Guidelines
- **Always Static Types**: Enforce type hints on variables, parameters, and returns (`func take_damage(amount: int) -> void:`).
- **Node Caching**: Use `@onready var` for child node caching; never call `get_node()` repeatedly inside `_process`.
- **Export Annotations**: Use `@export` with typed annotations (`@export_range`, `@export_file`, `@export_node_path`).
- **Call Down, Signal Up**: Strictly follow decoupled communication.

## 3. Testing Standards
- Automated unit and scene testing with **GUT (Godot Unit Test)**.
