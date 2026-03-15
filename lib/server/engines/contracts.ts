import 'server-only';

import { query } from '@/lib/server/db';

export const ENGINE_VERSION = '1.0.0';
export const RULES_VERSION = '1.0.0';

export interface EngineResult<T> {
  status: 'success' | 'partial' | 'insufficient_data' | 'error';
  confidence: number;
  coverageConfidence: number;
  reasons: string[];
  insufficientDataReasons: string[];
  sourceTransactionIds: string[];
  dedupKey: string;
  generatedAt: string;
  engineVersion: string;
  rulesVersion: string;
  data: T;
}

export interface Explainable {
  explanation: string;
  contributingFactors: Array<{
    factor: string;
    weight: number;
    value: string;
  }>;
}

export interface AccountCompleteness {
  connectedAccountCount: number;
  staleAccountCount: number;
  oldestSyncAge: number;
  hasManualOnly: boolean;
  completenessScore: number;
}

export function buildDedupKey(parts: {
  userId: string;
  engine: string;
  entity: string;
  window: string;
  rulesVersion?: string;
}): string {
  const rv = parts.rulesVersion || RULES_VERSION;
  return `${parts.userId}:${parts.engine}:${parts.entity}:${parts.window}:${rv}`;
}

interface AccountRow {
  id: string;
  last_synced_at: string | null;
}

export async function computeAccountCompleteness(
  userId: string,
): Promise<AccountCompleteness> {
  const accountResult = await query<AccountRow>(
    `SELECT id, last_synced_at::text
     FROM financial_connector_accounts
     WHERE user_id = $1`,
    [userId],
  );

  const accounts = accountResult.rows;
  const connectedAccountCount = accounts.length;

  if (connectedAccountCount === 0) {
    return {
      connectedAccountCount: 0,
      staleAccountCount: 0,
      oldestSyncAge: 0,
      hasManualOnly: true,
      completenessScore: 0,
    };
  }

  const now = Date.now();
  const staleThresholdMs = 48 * 60 * 60 * 1000;

  let staleAccountCount = 0;
  let oldestSyncAgeMs = 0;

  for (const account of accounts) {
    if (!account.last_synced_at) {
      staleAccountCount += 1;
      continue;
    }

    const syncedAt = Date.parse(account.last_synced_at);
    if (!Number.isFinite(syncedAt)) {
      staleAccountCount += 1;
      continue;
    }

    const ageMs = now - syncedAt;
    if (ageMs > staleThresholdMs) {
      staleAccountCount += 1;
    }
    if (ageMs > oldestSyncAgeMs) {
      oldestSyncAgeMs = ageMs;
    }
  }

  const oldestSyncAge = Math.round(oldestSyncAgeMs / (60 * 60 * 1000));
  const hasManualOnly = false;

  const freshRatio =
    connectedAccountCount > 0
      ? (connectedAccountCount - staleAccountCount) / connectedAccountCount
      : 0;

  const accountCountFactor = Math.min(connectedAccountCount / 3, 1);
  const recencyFactor = oldestSyncAge <= 24 ? 1 : oldestSyncAge <= 48 ? 0.8 : 0.5;

  const completenessScore = Math.round(
    (freshRatio * 0.4 + accountCountFactor * 0.3 + recencyFactor * 0.3) * 100,
  ) / 100;

  return {
    connectedAccountCount,
    staleAccountCount,
    oldestSyncAge,
    hasManualOnly,
    completenessScore,
  };
}
