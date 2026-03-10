import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

interface VaultCipherPayloadV1 {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ct: string;
}

interface VaultKeyring {
  activeVersion: string;
  keys: Map<string, Buffer>;
}

declare global {
  var __agentWalletVaultKeyring: VaultKeyring | undefined;
}

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Vault key material is empty.');
  }

  const maybeBase64 = Buffer.from(trimmed, 'base64');
  if (maybeBase64.length === 32) {
    return maybeBase64;
  }

  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    const fromHex = Buffer.from(trimmed, 'hex');
    if (fromHex.length === 32) {
      return fromHex;
    }
  }

  const utf8 = Buffer.from(trimmed, 'utf8');
  if (utf8.length === 32) {
    return utf8;
  }

  throw new Error('Vault key must decode to exactly 32 bytes.');
}

function parseKeyringFromEnv(): VaultKeyring {
  const keyring = new Map<string, Buffer>();

  const keyringRaw = process.env.TOOLS_VAULT_KEYRING?.trim();
  if (keyringRaw) {
    const parts = keyringRaw.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
    for (const part of parts) {
      const separator = part.indexOf(':');
      if (separator <= 0 || separator === part.length - 1) {
        continue;
      }

      const version = part.slice(0, separator).trim();
      const keyRaw = part.slice(separator + 1).trim();
      if (!version || !keyRaw) continue;
      keyring.set(version, decodeKeyMaterial(keyRaw));
    }
  }

  if (keyring.size === 0) {
    const single = process.env.TOOLS_VAULT_MASTER_KEY?.trim();
    if (!single) {
      throw new Error('Tools vault key is not configured. Set TOOLS_VAULT_KEYRING or TOOLS_VAULT_MASTER_KEY.');
    }

    const version = process.env.TOOLS_VAULT_KEY_VERSION?.trim() || 'v1';
    keyring.set(version, decodeKeyMaterial(single));
  }

  const configuredActive = process.env.TOOLS_VAULT_ACTIVE_KEY_VERSION?.trim();
  const activeVersion = configuredActive && keyring.has(configuredActive)
    ? configuredActive
    : Array.from(keyring.keys())[0];

  if (!activeVersion) {
    throw new Error('No active tools vault key version is configured.');
  }

  return {
    activeVersion,
    keys: keyring,
  };
}

function getVaultKeyring(): VaultKeyring {
  if (globalThis.__agentWalletVaultKeyring) {
    return globalThis.__agentWalletVaultKeyring;
  }

  const parsed = parseKeyringFromEnv();
  globalThis.__agentWalletVaultKeyring = parsed;
  return parsed;
}

function keyForVersion(version: string): Buffer {
  const keyring = getVaultKeyring();
  const key = keyring.keys.get(version);
  if (!key) {
    throw new Error(`Missing tools vault key for version ${version}.`);
  }
  return key;
}

export function activeVaultKeyVersion(): string {
  return getVaultKeyring().activeVersion;
}

export function encryptVaultValue(value: unknown): { encrypted: string; keyVersion: string } {
  const keyVersion = activeVaultKeyVersion();
  const key = keyForVersion(keyVersion);

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value ?? null), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: VaultCipherPayloadV1 = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: encrypted.toString('base64'),
  };

  return {
    encrypted: JSON.stringify(payload),
    keyVersion,
  };
}

export function decryptVaultValue(encrypted: string, keyVersion: string): unknown {
  const payload = JSON.parse(encrypted) as Partial<VaultCipherPayloadV1>;
  if (payload.v !== 1 || payload.alg !== 'aes-256-gcm') {
    throw new Error('Unsupported vault cipher payload version.');
  }
  if (!payload.iv || !payload.tag || !payload.ct) {
    throw new Error('Malformed vault cipher payload.');
  }

  const key = keyForVersion(keyVersion);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const clear = Buffer.concat([
    decipher.update(Buffer.from(payload.ct, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(clear.toString('utf8')) as unknown;
}

export function redactSecretForLogs(value: string | undefined | null): string {
  if (!value) return '[redacted]';
  if (value.length <= 4) return '[redacted]';
  return `${value.slice(0, 1)}***${value.slice(-1)}`;
}
