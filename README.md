# Agent Wallet

Chat-first autonomous procurement wallet with real ledger truth.

## Money Truth Rules

- Wallet starts at `$0.00`.
- Balance is computed only from DB ledger rows with `status = succeeded`.
- Formula: `sum(succeeded credits) - sum(succeeded debits)`.
- Pending/failed/canceled rows never affect available balance.
- No localStorage or client state is used as money truth.
- No seeded/default/demo credits.

## Real Funding Flow (Stripe)

1. Client calls `POST /api/funding/create-session`.
2. User completes Stripe Checkout (`card`, Apple Pay via card wallet, optional Cash App Pay).
3. `POST /api/stripe/webhook` verifies Stripe signature.
4. On `checkout.session.completed` top-up, server writes ledger credit.
5. Wallet UI refreshes from `GET /api/wallet`.

## Real Send Flow (Stripe Connect)

1. Client calls `POST /api/wallet/send`.
2. Server runs guardrails (balance, max tx, daily/monthly limit, allow/block lists, approval threshold).
3. Recipient must be approved and mapped to a Stripe connected account (`acct_...`).
4. Server executes Stripe transfer.
5. Only on provider success does server write a succeeded debit.

## Core API Routes

- `GET /api/wallet`
- `PATCH /api/wallet/settings`
- `GET|POST|PATCH /api/wallet/recipients`
- `POST /api/wallet/send`
- `POST /api/funding/create-session`
- `POST /api/stripe/webhook`
- `POST /api/reason`
- `POST /api/tinyfish`

## Database

Postgres (`DATABASE_URL`) is the source of truth.

Tables:

- `wallet_users`
- `wallet_recipients`
- `ledger_entries`
- `stripe_webhook_events`
- `agent_tasks`
- `web_action_logs`
- `approval_decisions`

Schema file: `db/schema.sql`

## Required Environment

```bash
DATABASE_URL=postgres://...
WALLET_USER_ID=default-user # optional

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_ENABLE_CASHAPP_PAY=false

TINYFISH_API_KEY=
TINYFISH_API_BASE_URL=https://api.tinyfish.ai/v1
TINYFISH_VENDOR_RESEARCH_PATH=/vendor-research
TINYFISH_PURCHASE_PREPARE_PATH=/purchase/prepare
TINYFISH_PURCHASE_CONFIRM_PATH=/purchase/confirm
TINYFISH_SUBSCRIPTION_OPERATION_PATH=/subscription/operation
```

If any required integration key is missing, APIs fail with explicit errors. No mock/demo fallback is used.

## Run

```bash
npm install
npm run dev
```

Stripe webhook forwarding:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

