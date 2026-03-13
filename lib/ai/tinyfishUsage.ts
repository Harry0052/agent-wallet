export const maxTinyFishCallsPerSession = 5;
export const TINYFISH_LIMIT_ERROR_MESSAGE = 'TinyFish task limit reached. Please confirm additional tasks.';

export interface TinyFishUsageLogEntry {
  timestamp: string;
  tokensUsed: number;
  taskLabel?: string;
}

export interface TinyFishSessionUsage {
  sessionId: string;
  callCount: number;
  totalTokensUsed: number;
  lastCallAt: string | null;
  cooldownUntil: string | null;
  tokenLog: TinyFishUsageLogEntry[];
}

export interface TinyFishUsageDecision {
  allowed: boolean;
  error?: string;
  usage: TinyFishSessionUsage;
}

type TinyFishSessionState = {
  sessionId: string;
  callCount: number;
  totalTokensUsed: number;
  lastCallAtMs: number | null;
  cooldownUntilMs: number | null;
  tokenLog: TinyFishUsageLogEntry[];
};

declare global {
  var __tinyFishUsageBySession: Map<string, TinyFishSessionState> | undefined;
}

function usageStore(): Map<string, TinyFishSessionState> {
  if (!globalThis.__tinyFishUsageBySession) {
    globalThis.__tinyFishUsageBySession = new Map<string, TinyFishSessionState>();
  }
  return globalThis.__tinyFishUsageBySession;
}

function nowMs(): number {
  return Date.now();
}

function toIsoOrNull(value: number | null): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function clampTokens(tokensUsed: number): number {
  if (!Number.isFinite(tokensUsed) || tokensUsed <= 0) return 0;
  return Math.floor(tokensUsed);
}

function getOrInitSession(sessionId: string): TinyFishSessionState {
  const key = sessionId.trim();
  if (!key) {
    throw new Error('sessionId is required for TinyFish usage tracking.');
  }

  const store = usageStore();
  const existing = store.get(key);
  if (existing) return existing;

  const created: TinyFishSessionState = {
    sessionId: key,
    callCount: 0,
    totalTokensUsed: 0,
    lastCallAtMs: null,
    cooldownUntilMs: null,
    tokenLog: [],
  };

  store.set(key, created);
  return created;
}

function toPublicUsage(state: TinyFishSessionState): TinyFishSessionUsage {
  return {
    sessionId: state.sessionId,
    callCount: state.callCount,
    totalTokensUsed: state.totalTokensUsed,
    lastCallAt: toIsoOrNull(state.lastCallAtMs),
    cooldownUntil: toIsoOrNull(state.cooldownUntilMs),
    tokenLog: [...state.tokenLog],
  };
}

function isInCooldown(state: TinyFishSessionState, atMs: number): boolean {
  return Boolean(state.cooldownUntilMs && state.cooldownUntilMs > atMs);
}

export function getTinyFishUsage(sessionId: string): TinyFishSessionUsage {
  const state = getOrInitSession(sessionId);
  return toPublicUsage(state);
}

export function canUseTinyFish(input: {
  sessionId: string;
}): TinyFishUsageDecision {
  const state = getOrInitSession(input.sessionId);
  const atMs = nowMs();

  if (isInCooldown(state, atMs)) {
    return {
      allowed: false,
      error: `TinyFish is cooling down. Try again after ${new Date(state.cooldownUntilMs as number).toISOString()}.`,
      usage: toPublicUsage(state),
    };
  }

  if (state.callCount >= maxTinyFishCallsPerSession) {
    return {
      allowed: false,
      error: TINYFISH_LIMIT_ERROR_MESSAGE,
      usage: toPublicUsage(state),
    };
  }

  return {
    allowed: true,
    usage: toPublicUsage(state),
  };
}

export function recordTinyFishCall(input: {
  sessionId: string;
  tokensUsed?: number;
  taskLabel?: string;
  cooldownMs?: number;
}): TinyFishUsageDecision {
  const state = getOrInitSession(input.sessionId);
  const atMs = nowMs();

  if (isInCooldown(state, atMs)) {
    return {
      allowed: false,
      error: `TinyFish is cooling down. Try again after ${new Date(state.cooldownUntilMs as number).toISOString()}.`,
      usage: toPublicUsage(state),
    };
  }

  if (state.callCount >= maxTinyFishCallsPerSession) {
    return {
      allowed: false,
      error: TINYFISH_LIMIT_ERROR_MESSAGE,
      usage: toPublicUsage(state),
    };
  }

  const normalizedTokens = clampTokens(input.tokensUsed ?? 0);
  state.callCount += 1;
  state.totalTokensUsed += normalizedTokens;
  state.lastCallAtMs = atMs;

  state.tokenLog.push({
    timestamp: new Date(atMs).toISOString(),
    tokensUsed: normalizedTokens,
    taskLabel: input.taskLabel,
  });

  // Keep memory bounded while preserving recent usage history.
  if (state.tokenLog.length > 50) {
    state.tokenLog = state.tokenLog.slice(-50);
  }

  if (typeof input.cooldownMs === 'number' && Number.isFinite(input.cooldownMs) && input.cooldownMs > 0) {
    state.cooldownUntilMs = atMs + Math.floor(input.cooldownMs);
  } else {
    state.cooldownUntilMs = null;
  }

  return {
    allowed: true,
    usage: toPublicUsage(state),
  };
}

export function setTinyFishCooldown(input: {
  sessionId: string;
  cooldownMs: number;
}): TinyFishSessionUsage {
  const state = getOrInitSession(input.sessionId);
  if (Number.isFinite(input.cooldownMs) && input.cooldownMs > 0) {
    state.cooldownUntilMs = nowMs() + Math.floor(input.cooldownMs);
  } else {
    state.cooldownUntilMs = null;
  }
  return toPublicUsage(state);
}

export function resetTinyFishUsage(sessionId: string): TinyFishSessionUsage {
  const state = getOrInitSession(sessionId);
  state.callCount = 0;
  state.totalTokensUsed = 0;
  state.lastCallAtMs = null;
  state.cooldownUntilMs = null;
  state.tokenLog = [];
  return toPublicUsage(state);
}
