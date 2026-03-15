import 'server-only';

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertNodeRuntime } from '@/lib/server/runtimeGuard';

assertNodeRuntime();

type SecretRecord = Record<string, string>;

type GetSecretOptions = {
  minLength?: number;
  allowUnsafeCaller?: boolean;
};

type GetSecretFromAnyOptions = GetSecretOptions & {
  required?: boolean;
};

const SECRET_NAME_PATTERN = /(API_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|PRIVATE_KEY|MASTER_KEY|KEYRING|^PLAID_)/i;
const FORBIDDEN_SECRET_ACCESS_DIRS = ['ai', 'ai_spend_intelligence', 'agent', 'agents', 'frontend'] as const;
const FORBIDDEN_CALLER_PATH_MARKERS = [
  '/app/',
  '/ai/',
  '/ai_spend_intelligence/',
  '/frontend/',
  '/components/',
  '/services/',
];
const TRUSTED_CALLER_PATH_MARKERS = [
  '/app/api/',
  '/lib/server/',
  '/financial_connectors/',
  '/transactions/',
  '/security/',
  '/subscription_intelligence/',
  '/instrumentation.ts',
];

const REQUIRED_STARTUP_SECRETS = [
  'DATABASE_URL',
  'AUTH_SESSION_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PLAID_CLIENT_ID',
  'PLAID_SECRET',
] as const;

const REQUIRED_STARTUP_ONE_OF: ReadonlyArray<ReadonlyArray<string>> = [
  ['DATA_ENCRYPTION_KEYRING', 'DATA_ENCRYPTION_MASTER_KEY'],
  ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
];

declare global {
  var __agentWalletSecretsCache: Map<string, string> | undefined;
  var __agentWalletSecretsKnownValues: Set<string> | undefined;
  var __agentWalletVaultSecrets: SecretRecord | undefined;
  var __agentWalletSecretsStartupValidated: boolean | undefined;
  var __agentWalletForbiddenSecretDirCheckDone: boolean | undefined;
}

function secretsCache(): Map<string, string> {
  if (!globalThis.__agentWalletSecretsCache) {
    globalThis.__agentWalletSecretsCache = new Map<string, string>();
  }
  return globalThis.__agentWalletSecretsCache;
}

function knownSecretValues(): Set<string> {
  if (!globalThis.__agentWalletSecretsKnownValues) {
    globalThis.__agentWalletSecretsKnownValues = new Set<string>();
  }
  return globalThis.__agentWalletSecretsKnownValues;
}

function normalizeSecretValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function recordVaultSecrets(raw: unknown, target: SecretRecord): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Vault payload must be a JSON object map of secret keys.');
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || typeof key !== 'string') continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    target[key] = normalized;
  }
}

function loadVaultSecrets(): SecretRecord {
  if (globalThis.__agentWalletVaultSecrets) {
    return globalThis.__agentWalletVaultSecrets;
  }

  const loaded: SecretRecord = {};

  const inlineJson = process.env.SECRETS_VAULT_JSON?.trim();
  if (inlineJson) {
    try {
      recordVaultSecrets(JSON.parse(inlineJson), loaded);
    } catch (error) {
      throw new Error(
        `Failed to parse SECRETS_VAULT_JSON: ${error instanceof Error ? error.message : 'invalid JSON'}`,
      );
    }
  }

  const vaultPath = process.env.SECRETS_VAULT_PATH?.trim();
  if (vaultPath) {
    const resolvedPath = path.isAbsolute(vaultPath)
      ? vaultPath
      : path.resolve(process.cwd(), vaultPath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`SECRETS_VAULT_PATH does not exist: ${resolvedPath}`);
    }

    try {
      const contents = readFileSync(resolvedPath, 'utf8');
      recordVaultSecrets(JSON.parse(contents), loaded);
    } catch (error) {
      throw new Error(
        `Failed to parse SECRETS_VAULT_PATH JSON: ${error instanceof Error ? error.message : 'invalid JSON'}`,
      );
    }
  }

  globalThis.__agentWalletVaultSecrets = loaded;
  return loaded;
}

function callerAppearsUnsafe(): boolean {
  const stack = new Error().stack || '';

  const fromForbiddenPath = FORBIDDEN_CALLER_PATH_MARKERS.some((marker) => stack.includes(marker));
  if (!fromForbiddenPath) return false;

  const fromTrustedPath = TRUSTED_CALLER_PATH_MARKERS.some((marker) => stack.includes(marker));
  return !fromTrustedPath;
}

function assertSafeCaller(): void {
  if (callerAppearsUnsafe()) {
    throw new Error('SECURITY_VIOLATION: Secrets may only be loaded from trusted backend modules.');
  }
}

function readRawSecret(name: string): string | null {
  const vaultValue = loadVaultSecrets()[name];
  const normalizedVault = normalizeSecretValue(vaultValue);
  if (normalizedVault) return normalizedVault;

  return normalizeSecretValue(process.env[name]);
}

function maybeRecordKnownSecret(name: string, value: string): void {
  if (!SECRET_NAME_PATTERN.test(name)) return;
  if (value.length < 4) return;
  knownSecretValues().add(value);
}

function enforceMinimumLength(name: string, value: string, minLength?: number): void {
  if (!minLength) return;
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters.`);
  }
}

export function getRequiredSecret(name: string, options: GetSecretOptions = {}): string {
  if (!options.allowUnsafeCaller) {
    assertSafeCaller();
  }

  const cached = secretsCache().get(name);
  if (cached) {
    enforceMinimumLength(name, cached, options.minLength);
    maybeRecordKnownSecret(name, cached);
    return cached;
  }

  const value = readRawSecret(name);
  if (!value) {
    throw new Error(`Missing required secret: ${name}`);
  }

  enforceMinimumLength(name, value, options.minLength);
  secretsCache().set(name, value);
  maybeRecordKnownSecret(name, value);
  return value;
}

export function getOptionalSecret(name: string, options: GetSecretOptions = {}): string | null {
  if (!options.allowUnsafeCaller) {
    assertSafeCaller();
  }

  const cached = secretsCache().get(name);
  if (cached) {
    enforceMinimumLength(name, cached, options.minLength);
    maybeRecordKnownSecret(name, cached);
    return cached;
  }

  const value = readRawSecret(name);
  if (!value) return null;

  enforceMinimumLength(name, value, options.minLength);
  secretsCache().set(name, value);
  maybeRecordKnownSecret(name, value);
  return value;
}

export function getSecretFromAny(
  names: ReadonlyArray<string>,
  options?: GetSecretFromAnyOptions & { required?: true },
): string;
export function getSecretFromAny(
  names: ReadonlyArray<string>,
  options: GetSecretFromAnyOptions & { required: false },
): string | null;
export function getSecretFromAny(
  names: ReadonlyArray<string>,
  options: GetSecretFromAnyOptions = {},
): string | null {
  const required = options.required ?? true;

  for (const name of names) {
    const value = getOptionalSecret(name, options);
    if (value) return value;
  }

  if (required) {
    throw new Error(`Missing required secret: expected one of [${names.join(', ')}]`);
  }

  return null;
}

export function isSecretConfigured(name: string): boolean {
  return Boolean(getOptionalSecret(name, { allowUnsafeCaller: true }));
}

export function getKnownSecretValues(): string[] {
  return Array.from(knownSecretValues());
}

function secretLikeProcessEnvUsage(line: string): string[] {
  const matches = line.matchAll(/process\.env\.([A-Z0-9_]+)/g);
  const hits: string[] = [];
  for (const match of matches) {
    const key = match[1];
    if (SECRET_NAME_PATTERN.test(key)) {
      hits.push(key);
    }
  }
  return hits;
}

function scanFileForDirectSecretEnvUsage(absPath: string): Array<{ line: number; key: string }> {
  const content = readFileSync(absPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const findings: Array<{ line: number; key: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const hits = secretLikeProcessEnvUsage(lines[index]);
    for (const key of hits) {
      findings.push({ line: index + 1, key });
    }
  }

  return findings;
}

function walkFiles(rootDir: string, onFile: (absPath: string) => void): void {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
      walkFiles(absPath, onFile);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) continue;
    onFile(absPath);
  }
}

export function assertForbiddenDirectoriesDoNotAccessSecretsDirectly(): void {
  if (globalThis.__agentWalletForbiddenSecretDirCheckDone) {
    return;
  }

  const violations: string[] = [];
  const cwd = process.cwd();

  for (const dirName of FORBIDDEN_SECRET_ACCESS_DIRS) {
    const absDir = path.join(cwd, dirName);
    if (!existsSync(absDir)) continue;
    if (!statSync(absDir).isDirectory()) continue;

    walkFiles(absDir, (absFile) => {
      const findings = scanFileForDirectSecretEnvUsage(absFile);
      for (const finding of findings) {
        violations.push(`${path.relative(cwd, absFile)}:${finding.line} (${finding.key})`);
      }
    });
  }

  if (violations.length > 0) {
    throw new Error(
      [
        'SECURITY_VIOLATION: Direct secret access detected in restricted folders (/ai, /agents, /frontend).',
        ...violations.slice(0, 25).map((entry) => `- ${entry}`),
      ].join('\n'),
    );
  }

  globalThis.__agentWalletForbiddenSecretDirCheckDone = true;
}

export function validateRequiredSecretsAtStartup(): void {
  if (globalThis.__agentWalletSecretsStartupValidated) {
    return;
  }

  assertForbiddenDirectoriesDoNotAccessSecretsDirectly();

  const missing: string[] = [];

  for (const key of REQUIRED_STARTUP_SECRETS) {
    const value = getOptionalSecret(key, { allowUnsafeCaller: true, minLength: 1 });
    if (!value) {
      missing.push(key);
    }
  }

  for (const group of REQUIRED_STARTUP_ONE_OF) {
    const found = group.some((key) => Boolean(getOptionalSecret(key, { allowUnsafeCaller: true, minLength: 1 })));
    if (!found) {
      missing.push(`one of [${group.join(', ')}]`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Startup secret validation failed. Missing required secret values: ${missing.join('; ')}`,
    );
  }

  globalThis.__agentWalletSecretsStartupValidated = true;
}
