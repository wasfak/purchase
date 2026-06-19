<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# Project notes

nex-bb — Next.js 16 App Router project (created manually, not via create-next-app).

- **Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4.
- **Auth:** Clerk (`@clerk/nextjs`).
- **Database:** MongoDB via Mongoose.
- **UI:** Radix UI primitives, shadcn-style components (see `components.json`), lucide-react icons, framer-motion, sonner toasts, next-themes.
- **Path alias:** `@/*` maps to the project root.

## Commands

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — run ESLint
