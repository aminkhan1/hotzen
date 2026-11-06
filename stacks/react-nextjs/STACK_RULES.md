# ⚛️ Next.js 15 App Router & Server Components Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Next.js App Router with strict separation of Server Components (RSC) and Client Components:
  - `app/`: Next.js file-system routing:
    - `layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`.
    - `(auth)/`, `(dashboard)/`: Route groups for layout isolation.
    - `api/`: Route Handlers (`route.ts`) for webhook and proxy endpoints.
  - `actions/`: Server Actions with `'use server'` and strict Zod validation.
  - `components/server/`: Pure React Server Components for database and direct backend queries.
  - `components/client/`: Interactive components with `'use client'`.
  - `lib/`: Database clients (Prisma/Drizzle), auth (NextAuth/Auth.js), and server utilities.

## 2. Senior Next.js 15 Guidelines
- **Server Components by Default**: Never add `'use client'` at the top of a page. Keep pages as Server Components and push `'use client'` down to the leaves of the tree.
- **Secure Server Actions**: Every Server Action must validate inputs with Zod and check user session authorization before executing database queries.
- **Caching Strategy**: Explicitly manage Next.js caching: `fetch(url, { next: { revalidate: 3600, tags: ['posts'] } })` and revalidate with `revalidateTag()`.
- **Streaming & Suspense**: Wrap slow data-fetching components with `<Suspense fallback={<Skeleton />}>` for instant TTFB.
- **SEO & Metadata**: Implement dynamic `generateMetadata()` on every dynamic route.

## 3. Testing Standards
- Unit and Server Action testing with **Vitest**.
- End-to-end integration testing with **Playwright**.
