import 'server-only';

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { getOptionalSecret } from '@/security/secretsManager';

interface EncryptedPayloadV1 {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ct: string;
}

interface EncryptionKeyring {
  activeVersion: string;
  keys: Map<string, Buffer>;
  hashKey: Buffer;
}

declare global {
  var __agentWalletDataEncryptionKeyring: EncryptionKeyring | undefined;
}

function decodeFixedLengthKey(raw: string, expectedBytes: number): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Encryption key material is empty.');
  }

  const maybeBase64 = Buffer.from(trimmed, 'base64');
  if (maybeBase64.length === expectedBytes) {
    return maybeBase64;
  }

  if (/^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length === expectedBytes * 2) {
    const fromHex = Buffer.from(trimmed, 'hex');
    if (fromHex.length === expectedBytes) {
      return fromHex;
    }
  }

  const utf8 = Buffer.from(trimmed, 'utf8');
  if (utf8.length === expectedBytes) {
    return utf8;
  }

  throw new Error(`Encryption key must decode to exactly ${expectedBytes} bytes.`);
}

function decodeFlexibleKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Hash key material is empty.');
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0) {
    const maybeBase64 = Buffer.from(trimmed, 'base64');
    const normalizedInput = trimmed.replace(/=+$/, '');
    const normalizedDecoded = maybeBase64.toString('base64').replace(/=+$/, '');
    if (maybeBase64.length > 0 && normalizedDecoded === normalizedInput) {
      return maybeBase64;
    }
  }

  if (/^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const fromHex = Buffer.from(trimmed, 'hex');
    if (fromHex.length > 0) {
      return fromHex;
    }
  }

  return Buffer.from(trimmed, 'utf8');
}

function parseKeyring(): EncryptionKeyring {
  const keyring = new Map<string, Buffer>();

  const keyringRaw = getOptionalSecret('DATA_ENCRYPTION_KEYRING', { minLength: 1 });
  if (keyringRaw) {
    const parts = keyringRaw
      .split(/[;,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const part of parts) {
      const separator = part.indexOf(':');
      if (separator <= 0 || separator === part.length - 1) continue;

      const version = part.slice(0, separator).trim();
      const keyRaw = part.slice(separator + 1).trim();
      if (!version || !keyRaw) continue;
      keyring.set(version, decodeFixedLengthKey(keyRaw, 32));
    }
  }

  if (keyring.size === 0) {
    const single = getOptionalSecret('DATA_ENCRYPTION_MASTER_KEY', { minLength: 1 });
    if (!single) {
      throw new Error(
        'Data encryption key is not configured. Set DATA_ENCRYPTION_KEYRING or DATA_ENCRYPTION_MASTER_KEY.',
      );
    }

    const version = process.env.DATA_ENCRYPTION_KEY_VERSION?.trim() || 'v1';
    keyring.set(version, decodeFixedLengthKey(single, 32));
  }

  const configuredActive = process.env.DATA_ENCRYPTION_ACTIVE_KEY_VERSION?.trim();
  const activeVersion = configuredActive && keyring.has(configuredActive)
    ? configuredActive
    : Array.from(keyring.keys())[0];

  if (!activeVersion) {
    throw new Error('No active data encryption key version is configured.');
  }

  const activeKey = keyring.get(activeVersion);
  if (!activeKey) {
    throw new Error(`Active data encryption key is missing: ${activeVersion}`);
  }

  const configuredHashKey = getOptionalSecret('DATA_ENCRYPTION_HASH_KEY', { minLength: 1 });
  const hashKey = configuredHashKey
    ? decodeFlexibleKey(configuredHashKey)
    : createHmac('sha256', activeKey).update('agent-wallet:data-hash-key:v1').digest();

  return {
    activeVersion,
    keys: keyring,
    hashKey,
  };
}

function getKeyring(): EncryptionKeyring {
  if (globalThis.__agentWalletDataEncryptionKeyring) {
    return globalThis.__agentWalletDataEncryptionKeyring;
  }

  const parsed = parseKeyring();
  globalThis.__agentWalletDataEncryptionKeyring = parsed;
  return parsed;
}

function keyForVersion(version: string): Buffer {
  const key = getKeyring().keys.get(version);
  if (!key) {
    throw new Error(`Missing data encryption key for version ${version}.`);
  }
  return key;
}

export function activeEncryptionKeyVersion(): string {
  return getKeyring().activeVersion;
}

export function encryptData(value: unknown): { encrypted: string; keyVersion: string } {
  const keyVersion = activeEncryptionKeyVersion();
  const key = keyForVersion(keyVersion);

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value ?? null), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayloadV1 = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64'),
  };

  return {
    encrypted: JSON.stringify(payload),
    keyVersion,
  };
}

export function decryptData<T = unknown>(encrypted: string, keyVersion: string): T {
  const payload = JSON.parse(encrypted) as Partial<EncryptedPayloadV1>;
  if (payload.v !== 1 || payload.alg !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted payload version.');
  }
  if (!payload.iv || !payload.tag || !payload.ct) {
    throw new Error('Malformed encrypted payload.');
  }

  const key = keyForVersion(keyVersion);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ct, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString('utf8')) as T;
}

export function hashSensitiveValue(value: string, scope: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Cannot hash an empty sensitive value.');
  }

  const key = getKeyring().hashKey;
  const digest = createHmac('sha256', key)
    .update(`scope=${scope};value=${normalized}`)
    .digest('base64url');

  return `h1:${digest}`;
}
