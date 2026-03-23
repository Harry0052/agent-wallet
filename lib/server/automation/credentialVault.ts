import 'server-only';

import { randomUUID, randomBytes } from 'node:crypto';
import { encryptData, decryptData, hashSensitiveValue } from '@/security/encryption';
import { logServerEvent } from '@/lib/server/observability';

// ── Ephemeral Credential Vault ──────────────────────────────────────────────
//
// Security design:
// 1. Credentials are encrypted at rest using AES-256-GCM (existing keyring)
// 2. Each credential has a short TTL (default 5 minutes, max 10 minutes)
// 3. Credentials are single-use — consumed and destroyed on first read
// 4. An access token (random 48-byte hex) is required to retrieve
// 5. Credential values are NEVER logged — only hashed fingerprints for audit
// 6. Background cleanup runs to purge expired entries
// 7. In-memory store — does NOT persist across server restarts (by design)

const DEFAULT_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const MAX_TTL_MS = 10 * 60 * 1000;      // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000;   // sweep every 60s
const MAX_VAULT_SIZE = 500;              // prevent unbounded growth

export type CredentialInputType =
  | 'email'
  | 'password'
  | 'otp'
  | '2fa_code'
  | 'security_answer'
  | 'pin'
  | 'username'
  | 'phone';

export interface CredentialRequest {
  id: string;
  taskId: string;
  userId: string;
  service: string;
  inputType: CredentialInputType;
  prompt: string;
  hint?: string;
  expiresAt: string;
  createdAt: string;
}

interface VaultEntry {
  requestId: string;
  taskId: string;
  userId: string;
  encryptedValue: string;
  keyVersion: string;
  accessTokenHash: string;
  inputType: CredentialInputType;
  service: string;
  consumed: boolean;
  expiresAt: number;
  createdAt: number;
}

// ── In-memory store ─────────────────────────────────────────────────────────

const vault = new Map<string, VaultEntry>();
const pendingRequests = new Map<string, CredentialRequest>();

// ── Cleanup ─────────────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let purged = 0;

    for (const [id, entry] of vault) {
      if (entry.expiresAt <= now || entry.consumed) {
        vault.delete(id);
        purged++;
      }
    }

    for (const [id, req] of pendingRequests) {
      if (Date.parse(req.expiresAt) <= now) {
        pendingRequests.delete(id);
        purged++;
      }
    }

    if (purged > 0) {
      logServerEvent('info', 'credential_vault.cleanup', {
        purgedCount: purged,
        remainingCount: vault.size,
      });
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent process exit
  if (cleanupTimer.unref) cleanupTimer.unref();
}

startCleanup();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a credential request for a task that needs user input.
 * Returns a request object to show the user + an internal request ID.
 */
export function createCredentialRequest(input: {
  taskId: string;
  userId: string;
  service: string;
  inputType: CredentialInputType;
  prompt: string;
  hint?: string;
  ttlMs?: number;
}): CredentialRequest {
  const ttl = Math.min(input.ttlMs ?? DEFAULT_TTL_MS, MAX_TTL_MS);
  const now = Date.now();

  const request: CredentialRequest = {
    id: randomUUID(),
    taskId: input.taskId,
    userId: input.userId,
    service: input.service,
    inputType: input.inputType,
    prompt: input.prompt,
    hint: input.hint,
    expiresAt: new Date(now + ttl).toISOString(),
    createdAt: new Date(now).toISOString(),
  };

  pendingRequests.set(request.id, request);

  logServerEvent('info', 'credential_vault.request_created', {
    requestId: request.id,
    taskId: input.taskId,
    userId: input.userId,
    service: input.service,
    inputType: input.inputType,
    expiresAt: request.expiresAt,
    // NOTE: prompt logged because it's user-facing copy, NOT sensitive
  });

  return request;
}

/**
 * Get a pending credential request for display to the user.
 */
export function getCredentialRequest(input: {
  requestId: string;
  userId: string;
}): CredentialRequest | null {
  const req = pendingRequests.get(input.requestId);
  if (!req) return null;
  if (req.userId !== input.userId) return null;
  if (Date.parse(req.expiresAt) <= Date.now()) {
    pendingRequests.delete(input.requestId);
    return null;
  }
  return req;
}

/**
 * List active credential requests for a user's task.
 */
export function listCredentialRequestsForTask(input: {
  taskId: string;
  userId: string;
}): CredentialRequest[] {
  const now = Date.now();
  const results: CredentialRequest[] = [];

  for (const req of pendingRequests.values()) {
    if (req.taskId === input.taskId && req.userId === input.userId) {
      if (Date.parse(req.expiresAt) > now) {
        results.push(req);
      }
    }
  }

  return results;
}

export interface CredentialSubmitResult {
  requestId: string;
  accessToken: string;
}

/**
 * Submit a credential value. The value is encrypted immediately.
 * Returns an access token that the execution engine uses to retrieve it.
 *
 * Security:
 * - Raw value is encrypted with AES-256-GCM before storage
 * - Access token is a random 48-byte hex string, stored as hash
 * - Entry auto-expires after TTL
 * - Entry is single-use (consumed on first retrieval)
 */
export function submitCredential(input: {
  requestId: string;
  userId: string;
  value: string;
}): CredentialSubmitResult | null {
  const request = pendingRequests.get(input.requestId);
  if (!request) return null;
  if (request.userId !== input.userId) return null;
  if (Date.parse(request.expiresAt) <= Date.now()) {
    pendingRequests.delete(input.requestId);
    return null;
  }

  // Enforce vault size limit
  if (vault.size >= MAX_VAULT_SIZE) {
    logServerEvent('warn', 'credential_vault.full', {
      size: vault.size,
      limit: MAX_VAULT_SIZE,
    });
    return null;
  }

  // Encrypt the credential value
  const { encrypted, keyVersion } = encryptData(input.value);

  // Generate an access token for the execution engine
  const accessToken = randomBytes(48).toString('hex');
  const accessTokenHash = hashSensitiveValue(accessToken, 'credential_access');

  // Create a fingerprint of the value for audit (never the value itself)
  const valueFingerprint = hashSensitiveValue(input.value, `credential:${request.inputType}`);

  const entry: VaultEntry = {
    requestId: request.id,
    taskId: request.taskId,
    userId: request.userId,
    encryptedValue: encrypted,
    keyVersion,
    accessTokenHash,
    inputType: request.inputType,
    service: request.service,
    consumed: false,
    expiresAt: Date.parse(request.expiresAt),
    createdAt: Date.now(),
  };

  vault.set(request.id, entry);

  // Remove from pending
  pendingRequests.delete(request.id);

  logServerEvent('info', 'credential_vault.submitted', {
    requestId: request.id,
    taskId: request.taskId,
    userId: request.userId,
    service: request.service,
    inputType: request.inputType,
    valueFingerprint,
    expiresAt: request.expiresAt,
    // NEVER log: input.value, encrypted, accessToken
  });

  return {
    requestId: request.id,
    accessToken,
  };
}

/**
 * Retrieve a credential value for execution. Single-use: destroys after read.
 *
 * This should ONLY be called by the execution engine, not by any user-facing code.
 */
export function consumeCredential(input: {
  requestId: string;
  accessToken: string;
}): { value: string; inputType: CredentialInputType; service: string } | null {
  const entry = vault.get(input.requestId);
  if (!entry) return null;
  if (entry.consumed) return null;
  if (entry.expiresAt <= Date.now()) {
    vault.delete(input.requestId);
    return null;
  }

  // Verify access token
  const providedHash = hashSensitiveValue(input.accessToken, 'credential_access');
  if (providedHash !== entry.accessTokenHash) {
    logServerEvent('warn', 'credential_vault.invalid_access_token', {
      requestId: input.requestId,
      taskId: entry.taskId,
      userId: entry.userId,
    });
    return null;
  }

  // Decrypt
  const value = decryptData<string>(entry.encryptedValue, entry.keyVersion);

  // Mark consumed and schedule deletion
  entry.consumed = true;
  entry.encryptedValue = ''; // clear encrypted data immediately

  // Delete from vault
  vault.delete(input.requestId);

  logServerEvent('info', 'credential_vault.consumed', {
    requestId: input.requestId,
    taskId: entry.taskId,
    userId: entry.userId,
    inputType: entry.inputType,
    service: entry.service,
    // NEVER log: value, accessToken
  });

  return {
    value,
    inputType: entry.inputType,
    service: entry.service,
  };
}

/**
 * Revoke a credential request (user cancelled, task failed, etc.)
 */
export function revokeCredentialRequest(input: {
  requestId: string;
  userId: string;
  reason: string;
}): boolean {
  const fromPending = pendingRequests.get(input.requestId);
  if (fromPending?.userId === input.userId) {
    pendingRequests.delete(input.requestId);
  }

  const fromVault = vault.get(input.requestId);
  if (fromVault?.userId === input.userId) {
    fromVault.encryptedValue = ''; // wipe encrypted data
    vault.delete(input.requestId);
  }

  const found = Boolean(fromPending || fromVault);

  if (found) {
    logServerEvent('info', 'credential_vault.revoked', {
      requestId: input.requestId,
      userId: input.userId,
      reason: input.reason,
    });
  }

  return found;
}

/**
 * Get vault stats for monitoring (no sensitive data).
 */
export function getVaultStats(): {
  pendingRequests: number;
  storedCredentials: number;
  consumedCount: number;
} {
  let consumed = 0;
  for (const entry of vault.values()) {
    if (entry.consumed) consumed++;
  }
  return {
    pendingRequests: pendingRequests.size,
    storedCredentials: vault.size,
    consumedCount: consumed,
  };
}
