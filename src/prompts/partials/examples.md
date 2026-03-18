## Example Skills (Real-World)

### Example: Base skill for a React/Next.js frontend

```markdown
---
name: base
description: Core conventions, tech stack, and project structure for frontend
---

## Activation

This is a **base skill** that always loads when working in this repository.

---

You are working in the **frontend** repository.

## Tech Stack
Next.js 16 (App Router) | React 19 | TypeScript | Tailwind CSS 4 | shadcn/ui | React Query

## Commands
- `npm run dev` — Start dev server
- `make check-frontend` — Lint + typecheck

## Reuse First — MANDATORY
Before creating ANY new component, hook, utility, or style:
1. **Search** the codebase for existing implementations
2. **Reuse** what exists — import it, don't recreate it
3. **Extend** if close but not exact — add a variant/prop
4. **Create new** only if nothing exists — put it in the shared location

## Critical Conventions
- Default to Server Components (no `'use client'` unless needed)
- Use `cn()` for conditional Tailwind classes
- Use React Query with query key factories for data fetching
- All API calls go through `src/lib/api/client.ts`

## Structure
- `src/app/` — Pages (App Router)
- `src/components/` — React components by domain
- `src/hooks/` — Custom hooks by domain
- `src/lib/` — Utilities, API clients
- `src/types/` — TypeScript definitions

---
**Last Updated:** 2026-03-18
```

### Example: Domain skill for billing

```markdown
---
name: billing
description: Stripe billing integration — subscriptions, usage tracking, webhooks
---

## Activation

This skill triggers when editing billing/payment-related files:
- `**/billing*.py`
- `**/stripe*.py`
- `**/usage*.py`
- `**/payments.py`

---

You are working on **billing, Stripe integration, and usage limits**.

## Key Files
- `stripe_service.py` — Thin Stripe SDK wrapper (customer, checkout, webhook verify)
- `billing_service.py` — Subscription state management (activate, cancel, plan switch)
- `usage_service.py` — Usage counters and limit checks
- `payments.py` — API routes: checkout, portal, cancel, webhooks

## Key Concepts
- **Webhook-driven:** Subscription state changes come from Stripe webhooks, not API calls
- **Plan switching:** Handles reactivate, upgrade (immediate proration), downgrade (at period end)
- **Usage gating:** `check_limit(user_id, limit_type)` returns structured 429 error data

## Critical Rules
- All Stripe SDK calls must use `run_in_threadpool` (sync SDK, async app)
- Webhook endpoint has NO JWT auth — verified by Stripe signature only
- Cancel = `cancel_at_period_end=True` (user keeps access until period end)

---
**Last Updated:** 2026-03-18
```

### Example: Base skill for a Python/FastAPI backend

```markdown
---
name: base
description: Core conventions, tech stack, and project structure for backend
---

## Activation

This is a **base skill** that always loads when working in this repository.

---

You are working in the **backend** repository.

## Tech Stack
FastAPI | Python 3.12 | Pydantic v2 | Supabase (PostgreSQL) | JWT Auth

## Commands
- `make run` — Start dev server (uvicorn)
- `make check-backend` — Lint + typecheck
- `make test` — Run pytest suite

## Critical Conventions
- Layered architecture: API routes → Services → Database
- Pydantic models for all request/response schemas
- Dependency injection via FastAPI `Depends()`
- Async by default — all service methods are async
- Supabase client via `get_supabase()` dependency

## Structure
- `app/api/v1/` — API route handlers
- `app/services/` — Business logic layer
- `app/models/` — Pydantic schemas
- `app/core/` — Config, security, dependencies
- `app/middleware/` — Request middleware
- `tests/` — pytest test suite

---
**Last Updated:** 2026-03-18
```
