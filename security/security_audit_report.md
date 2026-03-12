# Agent Wallet Security Audit Report

## Scope
Comprehensive audit of authentication, API surface, wallet/payment flows, financial connectors, transaction data handling, database access, AI integrations, and external API usage.

## Attack Surface Map

| Area | Primary Components | Security-Relevant Entry Points |
|---|---|---|
| Authentication | `lib/server/auth.ts`, `security/authGuard.ts`, `lib/server/authCookies.ts` | `/api/auth/*`, cookie-backed session validation, password reset/email verification tokens |
| API Endpoints | `app/api/**`, `proxy.ts`, `security/rateLimiter.ts`, `security/requestValidator.ts` | Public and authenticated REST endpoints, webhook endpoints |
| Wallet + Payments | `lib/server/ledger.ts`, `lib/payments/ledger.ts`, `lib/payments/twoPhasePayment.ts`, `lib/refunds/refundEngine.ts` | `/api/wallet/*`, `/api/payments/*`, `/api/refunds/*` |
| Financial Connectors | `financial_connectors/*`, `app/api/connect/*`, `transactions/*` | Plaid token exchange, account sync, transaction webhook |
| Transaction Data | `transactions/transactionRepository.ts`, `app/api/statements/*`, `app/api/connect/transactions/*` | Sync/read paths for normalized transactions and statements |
| Database Access | `database/dbService.ts`, `lib/server/db.ts` | Shared query layer, schema initialization, transactional writes |
| AI Integrations | `app/api/reason/route.ts`, `app/api/agent/*`, `app/api/procurement/*`, `app/api/ai/spending-analysis/route.ts`, `security/aiSanitizer.ts`, `security/promptGuard.ts` | User prompts and structured context sent to OpenAI/Claude/TinyFish |
| External APIs | Plaid, Stripe, OpenAI, Anthropic, TinyFish | API credentials, webhook validation, upstream request/response handling |

## Vulnerabilities Found

| ID | Risk | Vulnerability | Affected Area | Recommended Mitigation |
|---|---|---|---|---|
| AW-001 | **Medium** | Cookie-authenticated state-changing endpoints rely on `SameSite=Lax` without explicit CSRF token/origin checks. | Authenticated API routes | Add CSRF middleware (token or strict Origin/Referer validation for mutating methods). |
| AW-002 | **Medium** | Rate limiting is in-memory per runtime instance and can be bypassed in horizontally scaled or serverless multi-instance deployments. | `security/rateLimiter.ts` | Move limits to shared backend (Redis/Upstash/KV), keep route-specific scopes and per-user+IP keys. |
| AW-003 | **Medium** | Some DB helpers still accept dynamic SQL fragments (e.g., dynamic `WHERE`/column fragments). Current usage is internal, but pattern is high-risk if expanded. | `lib/recovery/recoveryEngine.ts`, `lib/payments/ledger.ts`, `lib/refunds/refundEngine.ts` | Restrict to enum-based allowlists or dedicated query builders; prohibit untrusted fragment inputs by type/API design. |
| AW-004 | **Medium** | Prompt injection detection is pattern-based and can be bypassed by obfuscated phrasing. | `security/promptGuard.ts`, AI routes | Add layered defenses: instruction hierarchy, allowlisted tools/data contracts, model-side refusal policies, and semantic prompt risk scoring. |
| AW-005 | **Medium** | Input validation middleware is not universally used; several routes still parse raw JSON directly, leading to inconsistent sanitization and malformed payload handling. | Selected `app/api/*` routes | Standardize all JSON route bodies through `validateJsonBody` + schema validation. |
| AW-006 | **Low** | Decryption occurs in multiple backend service layers; accidental response passthrough could leak decrypted fields if future handlers return internal objects directly. | Wallet/payment/connectors services | Add response DTO boundaries and centralized response redaction for sensitive fields. |

## Remediations Implemented During This Audit

- Added secure secrets module and startup enforcement: `security/secretsManager.ts`.
- Added automatic secret redaction for console logs: `security/redactSecrets.ts`.
- Added AES-256-GCM field encryption/decryption utilities: `security/encryption.ts`.
- Enforced protected backend secret usage paths and restricted direct secret access in AI/agents/frontend scopes.
- Added API hardening middleware:
  - `security/rateLimiter.ts`
  - `security/requestValidator.ts`
  - `security/authGuard.ts`
- Centralized DB query guardrails and dangerous-query detection: `database/dbService.ts`.
- Added AI data sanitization and prompt injection blocking:
  - `security/aiSanitizer.ts`
  - `security/promptGuard.ts`
- Tightened query parameterization in high-risk areas by replacing interpolated `LIMIT` values with placeholders.
- Hardened Plaid webhook shared-secret check using constant-time comparison.

## Prioritized Remediation Checklist

1. **P0 (Immediate)**: Implement CSRF protections for all mutating cookie-authenticated endpoints.
2. **P0 (Immediate)**: Migrate rate limiting from in-memory to a distributed store and include per-user controls.
3. **P1 (High)**: Refactor remaining dynamic SQL fragment callsites to strict allowlisted query builders.
4. **P1 (High)**: Enforce `validateJsonBody` usage across all JSON endpoints and block oversized request bodies.
5. **P1 (High)**: Add AI output egress policy checks to prevent sensitive response leakage.
6. **P2 (Medium)**: Add centralized response DTO/redaction layer for decrypted backend-only fields.
7. **P2 (Medium)**: Add automated security tests (CSRF, rate-limit bypass, SQL policy regression, prompt-injection bypass cases).
8. **P3 (Backlog)**: Add runtime anomaly alerts for repeated auth failures, blocked prompts, and dangerous query attempts.

## Security Posture Summary
Current posture is significantly improved with centralized secrets handling, encryption-at-rest controls, API guard middleware, and AI prompt/data protections. Remaining risk is concentrated in cross-site request protection, distributed abuse controls, and hardening dynamic SQL/query composition patterns.
