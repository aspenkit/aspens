## Example Skill

```markdown
---
name: billing
description: Stripe billing — subscriptions, usage tracking, webhooks
---

## Activation

This skill triggers when editing these files:
- `**/billing*.py`
- `**/stripe*.py`
- `**/usage*.py`

Keywords: billing, stripe, subscription, usage limits

---

You are working on **billing, Stripe integration, and usage limits**.

## Key Files
- `stripe_service.py` — Stripe SDK wrapper (customer, checkout, webhook verify)
- `billing_service.py` — Subscription state (activate, cancel, plan switch)
- `usage_service.py` — Usage counters and limit checks

## Key Concepts
- **Webhook-driven:** State changes come from Stripe webhooks, not API calls
- **Usage gating:** `check_limit(user_id, limit_type)` returns structured 429 data

## Critical Rules
- All Stripe SDK calls use `run_in_threadpool` (sync SDK, async app)
- Webhook endpoint has NO JWT auth — Stripe signature verification only
- Cancel = `cancel_at_period_end=True` (access until period end)

## References
- **Patterns:** `{{configDir}}/guidelines/billing/patterns.md`

---
**Last Updated:** 2026-03-18
```
