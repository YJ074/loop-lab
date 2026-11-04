# Loop Lab v1 — PRD

## Original problem statement (user)
Build Loop Lab v1: a browser-based SaaS where brands run measurable referral campaigns. Start with Shopify DTC brands. Workspaces, campaign management and templates, WhatsApp-first sharing with copy-link, conversion tracking (Shopify/webhooks, manual CSV fallback), a reward liability ledger (pending/approved/reversed, no payouts in v1), analytics (referral CPA vs paid CPA) and basic abuse controls. Stack: React frontend, FastAPI backend, MongoDB. "Start the task now."

## User choices
- Scope: Full v1 (Phases 1–4)
- Shopify conversions: webhook endpoint + demo mode (no live store; MOCKED via Simulate/CSV/webhook)
- Rewards: discount/coupon, store credit, fixed cash-equivalent (liability tracking only)
- Attribution: auto-verify high-confidence conversions, send the rest to review (per-campaign override: manual / auto-approve)
- Sign-in: Emergent-managed Google Sign-In; owner is yashjani074@gmail.com

## Architecture
- Backend: /app/backend/server.py (FastAPI, /api prefix, Motor). Collections: users, user_sessions, workspaces, campaigns, referrers, links, conversions, rewards, audit_logs.
- Frontend: /app/frontend/src — pages: Login, AuthCallback, Overview, Campaigns, CampaignDetail, Conversions, Rewards, AbuseQueue, Settings; AppLayout, StatCard, StatusBadge; lib/api.js (fmtMoney), context/AuthContext.js.
- Public webhook: POST /api/public/conversions/{webhook_token} (code, order_value, currency USD/EUR/GBP, channel whatsapp/copy_link, email, device_fingerprint, coupon_code)

## Implemented
### 2026-11-04
- Google sign-in, a workspace created and seeded with a demo campaign on first login, workspace settings and webhook URL
- Campaign builder: templates, audience, channels, reward type/value/currency, language, budget cap, approval mode and paid CPA benchmark, with validation. Campaign detail has advocates, share copy variants (en/es), Simulate, CSV import (reports skipped rows) and conversion review.
- Attribution confidence scoring. Abuse flags: self-referral, device reuse, coupon leakage. The abuse queue clears reviewed items; the new Rejected status reverses the reward.
- Reward ledger with per-currency totals and CSV export. Discount rewards are stored as a money amount (% of order). Budget cap holds rewards over the cap as pending.
- Analytics: funnel, KPIs, channel performance, campaign comparison. Mixed currencies are rolled up with INDICATIVE fixed FX rates (USD 1, EUR 1.08, GBP 1.27).
- Webhook referral codes are limited to the token's workspace
- Testing: iterations 1–3; all issues fixed and the final fixes curl-verified

## Backlog
- P1: Real Shopify app/OAuth + orders/create webhook (replace demo mode)
- P1: Budget-cap warning on manual approvals; live FX rates
- P2: Advocate-facing share page; team members/roles; a split of the large server.py into routers
