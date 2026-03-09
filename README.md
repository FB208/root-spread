# RootSpread

RootSpread is a project management tool built around a living mind-map style task tree.

## Workspace Layout

- `apps/web`: Next.js frontend
- `apps/api`: FastAPI backend
- `packages/ui`: shared UI package placeholder
- `packages/types`: shared types package placeholder
- `infra/docker`: local infrastructure for MySQL and Redis
- `scripts/windows`: PowerShell scripts for Windows-first local development

## Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS, React Flow
- Backend: FastAPI, SQLAlchemy, Alembic, Pydantic Settings
- Data: MySQL, Redis
- Email: Resend

## Quick Start

### 1. Start infrastructure

```powershell
docker compose -f infra/docker/compose.dev.yaml up -d
```

### 2. Install dependencies

```powershell
pnpm install
uv sync --project apps/api
```

### 3. Configure env files

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

### 4. Run development servers

```powershell
./scripts/windows/dev.ps1
```

Or run them separately:

```powershell
pnpm run dev:web
pnpm run dev:api
```

## Current Scope

- Product definition and task backlog are tracked in `task.md`
- Current delivery focuses on P0 scaffolding for web, api, workspace layout, and local development setup
