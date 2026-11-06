# ⚛️ React 19 & Vite Enterprise Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Modular Feature-Driven Clean Architecture with strict TypeScript:
  - `src/features/<feature-name>/`:
    - `components/`: Smart feature components and dumb presentational widgets.
    - `hooks/`: Feature-scoped custom hooks (`useCartActions`, `useProfileQuery`).
    - `api/`: TanStack Query hooks, mutation handlers, and typed API clients.
    - `stores/`: Feature-scoped Zustand slices (if client state is needed).
    - `types/`: Domain models and DTO interfaces.
  - `src/components/ui/`: Atomic design system components (Button, Modal, Input) completely decoupled from business logic.
  - `src/lib/`: Axios/Ky instance, query client configuration, telemetry, and utilities.

## 2. Senior React 19 & State Guidelines
- **Zero Prop Drilling**: Use Zustand for complex cross-tree client state; use TanStack Query for server state. Never store API data in Zustand.
- **Strict Typing**: Zero `any` or loose `object` types. All component props must be typed with explicit interfaces.
- **Optimized Re-renders**:
  - Keep state as local as possible.
  - Extract heavy interactive UI fragments into isolated sub-components.
  - Use `useCallback` / `useMemo` ONLY when passing references to memoized children (`React.memo`) or executing computationally expensive algorithms.
- **Forms & Validation**: Mandate React Hook Form with Zod schema validation (`zodResolver`).
- **Error Boundaries**: Wrap all route boundaries and async widgets with React `ErrorBoundary` and fallback skeletons.

## 3. Testing & Verification Standard
- Minimum 80% coverage on critical business hooks, Zustand stores, and complex forms.
- Unit & Component tests with **Vitest**, **React Testing Library**, and **MSW (Mock Service Worker)**.
- Mandatory `npm run lint` and `npm run test` without warnings prior to task completion.
