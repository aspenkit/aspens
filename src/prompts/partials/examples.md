## Example Skill

```markdown
---
name: billing
description: Stripe billing — subscriptions, usage tracking, webhooks
triggers:
  files:
    - stripe_service.py
    - billing_service.py
    - app/api/billing/**
  keywords:
    - billing
    - stripe
    - subscription
    - webhook
---

You are working on **billing, Stripe integration, and usage limits**.

## Domain purpose
Handle paid subscriptions, usage quotas, and Stripe-driven account state. Every paid feature gates on a successful subscription check; usage limits prevent runaway costs on metered features.

## Business rules / invariants
- Cancel = period-end, never immediate. Customers retain access until renewal date.
- Webhook endpoint has NO JWT auth — Stripe signature verification only.
- Usage limit hits return structured 429 with retry-after metadata; never silently degrade.

## Non-obvious behaviors
- Subscription state is webhook-driven, not API-poll driven. Don't trust local DB without a recent webhook timestamp.
- All Stripe SDK calls run via `run_in_threadpool` (sync SDK, async app).

## Critical files
- `stripe_service.py` — Stripe SDK wrapper (customer, checkout, webhook verify)
- `billing_service.py` — Subscription state machine (activate, cancel, plan switch)
- `usage_service.py` — Usage counters and limit checks

## Critical Rules
- Never set `cancel_at_period_end=False` on cancel — that immediately voids access.
- Webhook signature verification must run before any state mutation.

---
**Last Updated:** 2026-03-18
```
