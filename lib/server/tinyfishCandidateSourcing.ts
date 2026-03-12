import 'server-only';
import type { SourcingPassResult } from '@/lib/sourcing/workflow';
import { RawSourcedCandidateSchema } from '@/lib/sourcing/schemas';
import type { NormalizedSourcingRequest, RawSourcedCandidate, SourcingExecutionPlan } from '@/lib/sourcing/schemas';
import { getRequiredSecret } from '@/security/secretsManager';

function compact(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function resolvePassTimeoutMs(): number {
  const raw = Number(process.env.TINYFISH_SOURCING_PASS_TIMEOUT_MS || 90_000);
  if (!Number.isFinite(raw)) return 90_000;
  return Math.min(Math.max(Math.round(raw), 15_000), 300_000);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseDataPayload(data: string): Record<string, unknown> | null {
  if (!data || data === '[DONE]') return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return toRecord(parsed);
  } catch {
    return { message: data };
  }
}

function parseSse(raw: string): {
  progress: string[];
  terminalPayload: Record<string, unknown> | null;
} {
  const blocks = raw.split(/\r?\n\r?\n/);
  const progress: string[] = [];
  let terminalPayload: Record<string, unknown> | null = null;

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);

    let eventType: string | null = null;
    const dataParts: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed.startsWith('event:')) {
        eventType = trimmed.slice(6).trim();
      }
      if (trimmed.startsWith('data:')) {
        dataParts.push(trimmed.slice(5).trim());
      }
    }

    const payload = parseDataPayload(dataParts.join('\n').trim());
    if (!payload) continue;

    const message = firstString(payload, ['message', 'detail', 'summary', 'step']);
    if (message) progress.push(compact(message));

    const type = String(eventType || payload.type || payload.event || payload.status || '').toUpperCase();
    const terminal = type.includes('COMPLETE')
      || type.includes('DONE')
      || type.includes('FAILED')
      || type.includes('ERROR')
      || payload.resultJson
      || payload.result_json
      || payload.result;

    if (terminal) {
      terminalPayload = payload;
    }
  }

  return {
    progress,
    terminalPayload,
  };
}

function extractCandidates(payload: Record<string, unknown> | null): {
  candidates: RawSourcedCandidate[];
  invalidCount: number;
} {
  if (!payload) {
    return {
      candidates: [],
      invalidCount: 0,
    };
  }

  const rootResult = payload.resultJson || payload.result_json || payload.result || payload.data || payload;
  const resultRecord = toRecord(rootResult) || payload;

  const candidatesRaw = resultRecord.candidates
    || resultRecord.shortlist
    || resultRecord.profiles
    || resultRecord.results;

  if (!Array.isArray(candidatesRaw)) {
    return {
      candidates: [],
      invalidCount: 0,
    };
  }

  let invalidCount = 0;
  const candidates = candidatesRaw
    .map((item) => {
      const row = toRecord(item);
      if (!row) {
        invalidCount += 1;
        return null;
      }

      const sourceUrl = firstString(row, ['sourceUrl', 'url', 'profileUrl', 'profile_url', 'link']);
      if (!sourceUrl) {
        invalidCount += 1;
        return null;
      }

      const fullName = firstString(row, ['fullName', 'name', 'candidateName']);
      const currentTitle = firstString(row, ['currentTitle', 'title', 'headline']);
      const location = firstString(row, ['location']);
      const education = firstString(row, ['education']);
      const summary = firstString(row, ['summary', 'about', 'bio']);

      const skillsRaw = Array.isArray(row.skills)
        ? row.skills.map((skill) => String(skill).trim()).filter(Boolean)
        : [];

      const companyHistoryRaw = Array.isArray(row.companyHistory)
        ? row.companyHistory.map((company) => String(company).trim()).filter(Boolean)
        : Array.isArray(row.experience)
          ? row.experience.map((company) => String(company).trim()).filter(Boolean)
          : [];

      const yearsExperience = typeof row.yearsExperience === 'number'
        ? row.yearsExperience
        : typeof row.years_experience === 'number'
          ? row.years_experience
          : null;

      const remoteStatusRaw = firstString(row, ['remoteStatus', 'remote_status']);
      const normalizedRemoteStatus = remoteStatusRaw
        ? (remoteStatusRaw.toLowerCase().includes('remote')
          ? 'remote'
          : remoteStatusRaw.toLowerCase().includes('hybrid')
            ? 'hybrid'
            : remoteStatusRaw.toLowerCase().includes('on')
              ? 'onsite'
              : 'unknown')
        : undefined;

      const extractionConfidence = typeof row.extractionConfidence === 'number'
        ? row.extractionConfidence
        : typeof row.confidence === 'number'
          ? row.confidence
          : undefined;

      const candidate = {
        sourceUrl,
        fullName,
        currentTitle,
        location,
        remoteStatus: normalizedRemoteStatus,
        yearsExperience,
        skills: skillsRaw,
        companyHistory: companyHistoryRaw,
        education,
        summary,
        extractionConfidence,
      };

      const parsed = RawSourcedCandidateSchema.safeParse(candidate);
      if (!parsed.success) {
        invalidCount += 1;
        return null;
      }

      return parsed.data;
    })
    .filter((candidate): candidate is RawSourcedCandidate => Boolean(candidate));

  return {
    candidates,
    invalidCount,
  };
}

function buildGoal(input: {
  request: NormalizedSourcingRequest;
  plan: SourcingExecutionPlan;
  passIndex: number;
  query: string;
  seenProfileUrls: string[];
  knownCandidateCount: number;
}): string {
  const skillsText = input.request.requiredSkills.length > 0
    ? input.request.requiredSkills.join(', ')
    : 'No explicit required skills were provided.';
  const locationText = input.request.location || 'Any location';
  const remoteText = input.request.remotePreference;
  const remainingNeeded = Math.max(0, input.request.shortlistTarget - input.knownCandidateCount);
  const profileOpenBudget = Math.min(
    input.plan.bounds.maxProfilesOpened,
    Math.max(4, (remainingNeeded * 2) + 2),
  );

  return [
    `You are running a candidate sourcing task on Indeed for Agent Wallet.`,
    `Task: find up to ${input.request.shortlistTarget + 4} matching senior engineering candidates and return structured JSON.`,
    `Search query for this pass: ${input.query}`,
    `Role target: ${input.request.roleQuery}`,
    `Location target: ${locationText}`,
    `Remote preference: ${remoteText}`,
    `Required skills: ${skillsText}`,
    `Pass index: ${input.passIndex + 1} of ${input.plan.bounds.maxExtractionPasses}`,
    `Bounded exploration policy: max ${input.plan.bounds.maxResultPages} result pages, max ${profileOpenBudget} profiles this pass, no repeated profile extraction.`,
    `Already parsed profile URLs (skip these): ${input.seenProfileUrls.slice(0, 12).join(', ') || 'none'}`,
    `Efficiency rules:`,
    `1) If already signed in, do not repeat login.`,
    `2) Apply filters once and do not reapply unless state changes.`,
    `3) Do not revisit profile URLs already parsed.`,
    `4) Prefer parsing search result cards first; only open profile pages when required fields are missing.`,
    `5) Stop early when at least ${input.request.shortlistTarget} high-confidence candidates are found.`,
    `6) Keep action log compact and meaningful.`,
    `Return strict JSON:`,
    '{',
    '  "status": "success | failed | partial",',
    '  "resultPagesVisited": number,',
    '  "profilesVisited": number,',
    '  "stateChanged": boolean,',
    '  "compactActions": ["string"],',
    '  "candidates": [',
    '    {',
    '      "sourceUrl": "https://...",',
    '      "fullName": "string",',
    '      "currentTitle": "string",',
    '      "location": "string",',
    '      "remoteStatus": "remote|hybrid|onsite|unknown",',
    '      "yearsExperience": number|null,',
    '      "skills": ["string"],',
    '      "companyHistory": ["string"],',
    '      "education": "string|null",',
    '      "summary": "string",',
    '      "extractionConfidence": number',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

function extractTerminalResult(terminalPayload: Record<string, unknown> | null): Record<string, unknown> {
  if (!terminalPayload) return {};

  const payloadResult = terminalPayload.resultJson
    || terminalPayload.result_json
    || terminalPayload.result
    || terminalPayload.data
    || terminalPayload;

  if (typeof payloadResult === 'string') {
    try {
      const parsed = JSON.parse(payloadResult) as unknown;
      const parsedRecord = toRecord(parsed);
      if (parsedRecord) return parsedRecord;
    } catch {
      return {
        status: 'failed',
        compactActions: [compact(payloadResult)],
      };
    }
  }

  return toRecord(payloadResult) || terminalPayload;
}

export async function runIndeedCandidateSourcingPass(input: {
  taskId: string;
  request: NormalizedSourcingRequest;
  plan: SourcingExecutionPlan;
  passIndex: number;
  query: string;
  seenProfileUrls: string[];
  knownCandidateCount: number;
}): Promise<SourcingPassResult> {
  const apiKey = getRequiredSecret('TINYFISH_API_KEY');

  const endpoint = process.env.TINYFISH_AUTOMATION_RUN_SSE_URL || 'https://agent.tinyfish.ai/v1/automation/run-sse';
  const startUrl = process.env.TINYFISH_INDEED_START_URL || 'https://www.indeed.com/';
  const timeoutMs = resolvePassTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: startUrl,
        goal: buildGoal(input),
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(`TinyFish sourcing pass timed out after ${timeoutMs}ms`);
      (timeoutError as Error & { code?: string; stateChanged?: boolean }).code = 'TIMEOUT';
      (timeoutError as Error & { code?: string; stateChanged?: boolean }).stateChanged = false;
      throw timeoutError;
    }
    throw error;
  }

  let raw = '';
  try {
    raw = await response.text();
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const message = `TinyFish sourcing pass failed (${response.status}): ${compact(raw).slice(0, 300)}`;
    const error = new Error(message);
    (error as Error & { code?: string; stateChanged?: boolean }).code = 'TRANSIENT_UPSTREAM';
    (error as Error & { code?: string; stateChanged?: boolean }).stateChanged = false;
    throw error;
  }

  const parsedSse = parseSse(raw);
  const terminalResult = extractTerminalResult(parsedSse.terminalPayload);
  const extracted = extractCandidates(terminalResult);
  const candidates = extracted.candidates;

  const profilesVisited = typeof terminalResult.profilesVisited === 'number'
    ? terminalResult.profilesVisited
    : Math.max(candidates.length, 0);

  const resultPagesVisited = typeof terminalResult.resultPagesVisited === 'number'
    ? terminalResult.resultPagesVisited
    : 1;

  const stateChanged = terminalResult.stateChanged === true || candidates.length > 0;
  const terminalStatus = firstString(terminalResult, ['status', 'state', 'result'])?.toLowerCase() || '';
  const failureMessage = firstString(terminalResult, ['message', 'error', 'detail', 'summary']);
  if ((terminalStatus.includes('fail') || terminalStatus.includes('error')) && candidates.length === 0) {
    const message = compact(failureMessage || 'TinyFish reported a failed sourcing pass.');
    const error = new Error(message);
    const lower = message.toLowerCase();
    if (lower.includes('captcha') || lower.includes('login') || lower.includes('authentication') || lower.includes('sign in')) {
      (error as Error & { code?: string; stateChanged?: boolean }).code = 'AUTH_REQUIRED';
    } else {
      (error as Error & { code?: string; stateChanged?: boolean }).code = 'TRANSIENT_UPSTREAM';
    }
    (error as Error & { code?: string; stateChanged?: boolean }).stateChanged = stateChanged;
    throw error;
  }

  const compactActions = Array.isArray(terminalResult.compactActions)
    ? terminalResult.compactActions.map((item) => compact(String(item))).filter(Boolean)
    : parsedSse.progress.slice(-8);

  return {
    candidates,
    profilesVisited,
    resultPagesVisited,
    stateChanged,
    compactActions,
    invalidCandidates: extracted.invalidCount,
  };
}
