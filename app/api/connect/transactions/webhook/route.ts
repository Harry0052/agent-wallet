import { NextRequest, NextResponse } from "next/server";
import { createVerify, timingSafeEqual } from "node:crypto";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import {
  handlePlaidTransactionWebhook,
  type PlaidWebhookPayload,
} from "@/transactions/transactionWebhook";
import { getOptionalSecret, getRequiredSecret } from "@/security/secretsManager";

export const runtime = "nodejs";
export const maxDuration = 30;

// ── Plaid JWT Webhook Verification ──────────────────────────────────────────
// Verifies webhooks using the `Plaid-Verification` header (JWT signed by Plaid).
// Falls back to shared-secret verification if JWT is not present.
// In production, at least one verification method must succeed.

interface JwtHeader {
  alg: string;
  kid: string;
  typ: string;
}

interface JwtPayload {
  iat: number;
  request_body_sha256: string;
}

// Cache JWKs for 24 hours to avoid repeated fetches
let jwkCache: Map<string, { key: string; fetchedAt: number }> = new Map();
const JWK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function parseJwt(token: string): {
  header: JwtHeader;
  payload: JwtPayload;
  signatureInput: string;
  signature: Buffer;
} {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT: expected 3 parts.");
  }

  const header = JSON.parse(base64UrlDecode(parts[0]).toString("utf-8")) as JwtHeader;
  const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf-8")) as JwtPayload;
  const signatureInput = `${parts[0]}.${parts[1]}`;
  const signature = base64UrlDecode(parts[2]);

  return { header, payload, signatureInput, signature };
}

async function fetchPlaidJwk(kid: string): Promise<string> {
  const cached = jwkCache.get(kid);
  if (cached && Date.now() - cached.fetchedAt < JWK_CACHE_TTL_MS) {
    return cached.key;
  }

  const plaidEnv = process.env.PLAID_ENV?.trim().toLowerCase() || "sandbox";
  const baseUrls: Record<string, string> = {
    sandbox: "https://sandbox.plaid.com",
    development: "https://development.plaid.com",
    production: "https://production.plaid.com",
  };
  const baseUrl = baseUrls[plaidEnv] || baseUrls.sandbox;

  const clientId = getRequiredSecret("PLAID_CLIENT_ID");
  const secret = getRequiredSecret("PLAID_SECRET");

  const response = await fetch(`${baseUrl}/webhook_verification_key/get`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      secret,
      key_id: kid,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Plaid JWK for kid=${kid}: ${response.status}`);
  }

  const data = (await response.json()) as {
    key: {
      alg: string;
      crv: string;
      kid: string;
      kty: string;
      use: string;
      x: string;
      y: string;
    };
  };

  // Convert JWK to PEM for Node.js crypto verification
  const jwk = data.key;
  const keyObject = await globalThis.crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: jwk.crv },
    true,
    ["verify"],
  );
  const exported = await globalThis.crypto.subtle.exportKey("spki", keyObject);
  const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(exported).toString("base64")}\n-----END PUBLIC KEY-----`;

  jwkCache.set(kid, { key: pem, fetchedAt: Date.now() });

  // Evict old keys
  if (jwkCache.size > 20) {
    const oldest = [...jwkCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (let i = 0; i < oldest.length - 10; i++) {
      jwkCache.delete(oldest[i][0]);
    }
  }

  return pem;
}

async function verifyPlaidJwt(token: string, rawBody: string): Promise<boolean> {
  try {
    const { header, payload, signatureInput, signature } = parseJwt(token);

    // Validate algorithm
    if (header.alg !== "ES256") {
      logServerEvent("warn", "connect.webhook.jwt.invalid_alg", { alg: header.alg });
      return false;
    }

    // Validate timestamp (within 5 minutes)
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - payload.iat);
    if (ageSeconds > 300) {
      logServerEvent("warn", "connect.webhook.jwt.expired", { ageSeconds });
      return false;
    }

    // Validate body hash
    const bodyHash = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawBody),
    );
    const expectedHash = Buffer.from(bodyHash).toString("hex");
    if (payload.request_body_sha256 !== expectedHash) {
      logServerEvent("warn", "connect.webhook.jwt.body_mismatch", {});
      return false;
    }

    // Fetch JWK and verify signature
    const pem = await fetchPlaidJwk(header.kid);
    const verifier = createVerify("SHA256");
    verifier.update(signatureInput);
    verifier.end();

    return verifier.verify(
      { key: pem, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch (error) {
    logServerEvent("error", "connect.webhook.jwt.verification_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

// ── Legacy shared-secret verification (fallback) ────────────────────────────

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySharedSecret(req: NextRequest): boolean {
  const expected = getOptionalSecret("PLAID_WEBHOOK_SHARED_SECRET");
  if (!expected) return false;
  const provided = req.headers.get("x-plaid-webhook-secret")?.trim();
  return Boolean(provided && secureEqual(provided, expected));
}

// ── Combined verification ───────────────────────────────────────────────────

async function verifyWebhookSecret(req: NextRequest, rawBody: string = ""): Promise<boolean> {
  const plaidEnv = process.env.PLAID_ENV?.trim().toLowerCase();

  // Try JWT verification first (preferred)
  const jwtToken = req.headers.get("plaid-verification")?.trim();
  if (jwtToken) {
    const jwtValid = await verifyPlaidJwt(jwtToken, rawBody);
    if (jwtValid) return true;

    logServerEvent("warn", "connect.webhook.jwt.failed_falling_back", {
      env: plaidEnv,
    });
  }

  // Fall back to shared secret
  if (verifySharedSecret(req)) return true;

  // In sandbox/development only, allow unverified webhooks if no verification is configured.
  // On Vercel production deployments this bypass is always disabled regardless of PLAID_ENV.
  if (plaidEnv !== "production" && process.env.VERCEL_ENV !== "production") {
    const hasAnySecret = getOptionalSecret("PLAID_WEBHOOK_SHARED_SECRET");
    if (!hasAnySecret && !jwtToken) {
      logServerEvent("warn", "connect.webhook.unverified_sandbox", { env: plaidEnv });
      return true;
    }
  }

  return false;
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    if (!(await verifyWebhookSecret(req))) {
      logServerEvent("warn", "connect.webhook.verification_failed", {});
      return NextResponse.json(
        apiError("VALIDATION_ERROR", "Webhook verification failed.", false),
        { status: 401 },
      );
    }

    const body = (JSON.parse(rawBody) as PlaidWebhookPayload) ?? {};
    const result = await handlePlaidTransactionWebhook(body);

    logServerEvent("info", "connect.transactions.webhook", {
      webhookType: body.webhook_type || null,
      webhookCode: body.webhook_code || null,
      itemId: body.item_id || null,
      handled: result.handled,
      syncedItems: result.synced_items,
      syncedUsers: result.synced_users,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to process Plaid webhook.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.transactions.webhook.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
