import "server-only";
import { createSign } from "node:crypto";
import { getRequiredSecret } from "@/security/secretsManager";

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface GoogleServiceAccountConfig {
  clientEmail: string;
  privateKey: string;
}

let cachedToken: CachedToken | null = null;

function base64UrlEncode(input: Buffer | string): string {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return source
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function loadGoogleServiceAccountConfig(): GoogleServiceAccountConfig {
  const clientEmail = getRequiredSecret("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKeyRaw = getRequiredSecret("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  return {
    clientEmail,
    privateKey,
  };
}

function signJwtAssertion(config: GoogleServiceAccountConfig, scope: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: config.clientEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign("RSA-SHA256");
  signer.update(toSign);
  signer.end();

  const signature = signer.sign(config.privateKey);
  return `${toSign}.${base64UrlEncode(signature)}`;
}

export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }

  const config = loadGoogleServiceAccountConfig();
  const assertion = signJwtAssertion(config, scopes.join(" "));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!response.ok || !payload?.access_token) {
    const reason = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`Failed to get Google access token: ${reason}`);
  }

  cachedToken = {
    token: payload.access_token,
    expiresAt: now + (payload.expires_in || 3600) * 1000,
  };

  return payload.access_token;
}
