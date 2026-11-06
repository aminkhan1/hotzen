# 🤖 Godot Engine 4 & C# (.NET 8) Enterprise Rules

## 1. Core Architecture & Folder Hierarchy
- **Node Composition & Signal-Driven Architecture**:
  - `Scenes/`: Modular scene files (`.tscn`) composed of reusable sub-scenes.
  - `Scripts/Nodes/`: Custom C# Node controllers extending `Node`, `Node2D`, or `Node3D`.
  - `Scripts/Resources/`: Custom `Resource` subclasses for shared game data and configurations.
  - `Scripts/Autoloads/`: Global state singletons for audio, save systems, and scene management.

## 2. Senior Godot & C# Guidelines
- **Call Down, Signal Up**: Parent nodes call public methods on children; children emit C# `[Signal]` events upwards.
- **Inspector Data**: Use `[Export]` attributes to expose configurable variables to the Godot Inspector.
- **Memory Management**: Explicitly free nodes (`QueueFree()`) and dispose unmanaged resources.
- **Physics vs Visual**: Execute physics updates in `_PhysicsProcess(double delta)` and visual rendering in `_Process(double delta)`.

## 3. Testing Standards
- Unit and integration testing with **NUnit** / **GdUnit4.Net**.
