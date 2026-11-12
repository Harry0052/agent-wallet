# Launch Hardening Report

Date: 2026-03-25

---

## 1. Changes Made

### 1.1 Removed debug/information-leak surface
- **Deleted** `app/api/debug/health/route.ts` — exposed which env vars are present/missing, `NODE_ENV`, `NEXT_RUNTIME`, and startup secrets state. Even though it was behind auth, this is an unnecessary information leak in production. The route's own comment said "DELETE THIS ROUTE after debugging."
- **Cleaned up** `app/api/smart/telemetry/recent/route.ts` — removed verbose debug metadata fields (`purpose`, `authoritative`, `note`) from the response body. The route remains functional (auth-gated, rate-limited) but no longer self-identifies as a debug surface.

### 1.2 Hardened password reset secrets
- **`lib/server/auth.ts`**: In production (`NODE_ENV === 'production'`), `getPasswordResetSecret()` now calls `getRequiredSecret('AUTH_PASSWORD_RESET_SECRET')` — the server will fail loudly if this dedicated secret is missing, instead of silently falling back to the session secret. Dev/test environments retain the fallback for convenience.
- **`app/api/auth/forgot-password/route.ts`**: Added a safety net that checks `VERCEL_ENV === 'production'` and refuses to echo reset tokens even if `AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN` is accidentally set. Logs an error if this condition is detected.

### 1.3 Cleaned up incomplete email verification
- **Removed** `issueEmailVerificationToken()` and all supporting code (`hashEmailVerificationToken`, `getEmailVerificationSecret`, `EMAIL_VERIFICATION_TTL_MS`) from `lib/server/auth.ts`. This was scaffold-only code — tokens were issued but never consumed (no verification endpoint existed). Shipping half-built auth logic is riskier than removing it. A comment documents what to implement when the full flow is ready.

### 1.4 Documented CORS / same-origin posture
- **`next.config.js`**: Added explicit comment documenting the same-origin-only posture. No `Access-Control-Allow-Origin` header is set, so browsers block cross-origin requests by default. This is correct for this app.
- **Added** `Strict-Transport-Security` header (`max-age=63072000; includeSubDomains; preload`) to enforce HTTPS.

### 1.5 Added Sentry error tracking
- **Installed** `@sentry/nextjs` dependency.
- **Created** `lib/server/sentry.ts` — initialization module with:
  - Environment/release tagging from Vercel env vars
  - Filtered `beforeSend` (drops expected AuthError, rate limit noise)
  - `captureException()` helper with context support
- **Wired into** `instrumentation.node.ts` — Sentry initializes on server cold start.
- **Wired into** `lib/server/observability.ts` — all `logServerEvent('error', ...)` calls now forward to Sentry automatically.
- **Wired into** error boundaries (`app/error.tsx`, `app/(app)/error.tsx`) — client-side unhandled errors are captured.

### 1.6 Improved observability
- **`app/api/auth/login/route.ts`**: Added structured `logServerEvent` calls for auth failures (warn-level for 401, error-level for 500). Auth failures are now visible in structured logs and forwarded to Sentry.
- **`app/api/auth/forgot-password/route.ts`**: Added error logging for unexpected failures (non-validation errors that produce a 200 to avoid user enumeration).
- **Telemetry route**: Cleaned up debug metadata from response.

### 1.7 Admin override hardening
- **`security/authGuard.ts`**: `isAdminByOverrideHeader()` now enforces a minimum 48-character token length. Tokens shorter than this are rejected with an error log, preventing weak tokens from being used in production.

### 1.8 Plaid webhook hardening
- **`app/api/connect/transactions/webhook/route.ts`**: The sandbox unverified-webhook bypass now also checks `VERCEL_ENV !== 'production'`. Even if `PLAID_ENV` is misconfigured, webhooks on a Vercel production deployment will always require verification.

### 1.9 Statements pipeline
The statements pipeline (`statements/statementParser.ts`) uses pure text parsing (no filesystem, no `/tmp`, no PDF libraries). It is safe for production — no hardening needed beyond what exists. The parser operates on text strings passed from the API layer and does not access storage directly.

---

## 2. Risks That Remain

| Risk | Severity | Notes |
|------|----------|-------|
| Admin override token is a single shared secret | Medium | Works for launch with the 48-char minimum. Replace with proper role-based admin auth post-launch. |
| Email verification not implemented | Low | Users can sign up without verifying email. Acceptable for launch; implement before adding sensitive account recovery flows. |
| In-memory rate limiting resets on cold start | Low | Acceptable for serverless. If abuse is observed, migrate to Upstash Redis rate limiting. |
| In-memory session cache (60s TTL) | Low | Could serve a revoked session for up to 60s. Acceptable tradeoff for DB pressure reduction. |
| Plaid sandbox bypass still exists for non-production | Info | By design — only affects development/preview deployments. |
| Speed Insights package installed but not initialized | Info | `@vercel/speed-insights` is in dependencies but never imported/rendered. Either add `<SpeedInsights />` to the root layout or remove the package. |

---

## 3. Environment Variables Added/Changed

| Variable | Required | Notes |
|----------|----------|-------|
| `AUTH_PASSWORD_RESET_SECRET` | **Yes (production)** | Must be at least 32 characters. Dedicated secret for password reset tokens. Generate with: `openssl rand -base64 48` |
| `SENTRY_DSN` | Recommended | Sentry project DSN for server-side error tracking. Get from sentry.io project settings. |
| `NEXT_PUBLIC_SENTRY_DSN` | Recommended | Same DSN, exposed to client for error boundary capture. Can be the same value as `SENTRY_DSN`. |
| `AUTH_ADMIN_OVERRIDE_TOKEN` | Optional | If set, must be at least 48 characters. Generate with: `openssl rand -base64 64` |

**Verify these are NOT set in production:**
| Variable | Must be absent |
|----------|---------------|
| `AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN` | Must not be `true` in production |

---

## 4. Manual Verification Checklist

Complete these before launch:

### Auth & Secrets
- [ ] Verify `AUTH_PASSWORD_RESET_SECRET` is set in Vercel production env (unique, >= 32 chars)
- [ ] Verify `AUTH_SESSION_SECRET` is set in Vercel production env (unique, >= 32 chars)
- [ ] Verify `AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN` is NOT set (or not `true`) in production env
- [ ] If using admin override: verify `AUTH_ADMIN_OVERRIDE_TOKEN` is >= 48 chars in production
- [ ] Verify `AUTH_ADMIN_EMAILS` / `ADMIN_EMAIL_ALLOWLIST` only contains intended admin emails

### Sentry
- [ ] Create a Sentry project for Agent Wallet
- [ ] Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in Vercel production env
- [ ] After deploy, trigger a test error and confirm it appears in Sentry

### Stripe
- [ ] Verify `STRIPE_SECRET_KEY` is the live-mode key (not test) in production
- [ ] Verify `STRIPE_WEBHOOK_SECRET` matches the webhook endpoint configured in Stripe dashboard
- [ ] Verify Stripe webhook endpoint URL points to production domain (`/api/stripe/webhook`)
- [ ] Verify subscription price IDs (`STRIPE_PRICE_STARTER_MONTHLY`, etc.) are live-mode prices
- [ ] Run one test checkout flow end-to-end after deploy

### Plaid
- [ ] Verify `PLAID_ENV` is set to `production` in Vercel production env
- [ ] Verify `PLAID_CLIENT_ID` and `PLAID_SECRET` are production credentials
- [ ] Verify Plaid webhook URL in Plaid dashboard points to production `/api/connect/transactions/webhook`
- [ ] Run one Plaid Link connection test after deploy

### Infrastructure
- [ ] Verify production DNS and TLS are configured correctly
- [ ] Verify database connection string points to production DB
- [ ] Verify database backups are configured
- [ ] Verify `DATA_ENCRYPTION_KEYRING` or `DATA_ENCRYPTION_MASTER_KEY` is set

### Smoke Tests (post-deploy)
- [ ] Sign up with a new email
- [ ] Log in with that email
- [ ] Request a password reset (verify email is sent, token works)
- [ ] Connect a bank account via Plaid
- [ ] Subscribe to a plan via Stripe checkout
- [ ] Verify webhook delivery in Stripe dashboard (check for 200 responses)
- [ ] Monitor Vercel function logs for errors in the first hour
- [ ] Monitor Sentry for unexpected errors

---

## 5. Recommended Post-Launch Follow-ups

1. **Replace admin override token** with proper role-based admin authorization (e.g., admin panel with session-based access).
2. **Implement full email verification flow** — issue token on signup, verify on click, gate sensitive actions on `email_verified`.
3. **Add Redis-based rate limiting** (Upstash) if abuse patterns emerge — in-memory rate limiting doesn't persist across serverless instances.
4. **Remove or initialize Speed Insights** — `@vercel/speed-insights` is installed but unused. Either add `<SpeedInsights />` to root layout or remove the dependency.
5. **Add Sentry source maps** — configure `@sentry/nextjs` webpack plugin for readable stack traces in production.
6. **Session rotation** — consider rotating session tokens on sensitive actions (password change, plan upgrade).
7. **CSP header** — add a Content-Security-Policy header once the app's script/style sources are stable.

---

## 6. No Migrations Required

All changes are code-only. No database migrations, no infrastructure changes, no manual commands needed beyond setting env vars.
