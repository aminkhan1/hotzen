# 💚 Vue.js 3 & Nuxt 3 Enterprise Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Component-Driven Clean Architecture with Vue 3 SFC (`<script setup lang="ts">`):
  - `components/`: Pure UI components and feature-specific compound widgets.
  - `composables/`: Reusable stateful logic functions (`useAuth`, `useCart`, `useNotification`).
  - `stores/`: Pinia state stores written with Setup Store syntax (`defineStore('id', () => { ... })`).
  - `services/`: API clients, interceptors, and DTO transformation layers.
  - `types/`: Domain interfaces and TypeScript declaration files.

## 2. Senior Vue 3 & Composition API Guidelines
- **Always `<script setup lang="ts">`**: Never use Options API in modern codebases.
- **Reactivity Best Practices**:
  - Use `ref()` for primitives and `shallowRef()` / `ref()` for complex objects.
  - Never destructure reactive objects directly without `toRefs()` or `toValue()`.
  - Use `computed()` for derived state; never cause side-effects inside computed properties.
  - Use `watchEffect()` with cleanup functions (`onCleanup`) for auto-canceling async operations.
- **Props & Emits**: Always use type-based `defineProps<{ title: string; count?: number }>()` and `defineEmits<{ (e: 'submit', payload: FormData): void }>()`.
- **Async Components**: Utilize `defineAsyncComponent` and `<Suspense>` for code-splitting large widgets.

## 3. Testing Standards
- Unit testing for Composables and helper functions with **Vitest**.
- Component unit & interaction testing with **@vue/test-utils**.
