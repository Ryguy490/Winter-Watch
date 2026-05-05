# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### Winter Watch Kanata (`artifacts/winter-watch`)
- **Preview path**: `/`
- **Type**: react-vite, frontend-only (no backend)
- **Purpose**: Snow accumulation tracker for Camp Kanata, Wake Forest, NC (ZIP 27587)
- **Data source**: Open-Meteo free API (no API key needed), returns hourly snowfall in cm, converted to inches
- **Location**: Hardcoded to lat 35.9771, lon -78.5097
- **Features**:
  - Snow so far / Still to come / Total expected range
  - Hour-by-hour bar chart (past = gray, future = blue)
  - Peak snow time indicator
  - Check Again button
  - Auto-refresh toggle (10-minute interval)
  - Error handling with user-friendly message
- **Theme**: Dark mode, blues and gray palette
