import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { classifyRequest } from '@/lib/ai/classifier';
import {
  routeRequest,
  type ClaudeResearchResult,
  type GeminiResearchResult,
} from '@/lib/ai/router';
import { callClaudeMessagesApi } from '@/lib/server/claude';
import { callGeminiGenerateContent } from '@/lib/server/gemini';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { getSecretFromAny } from '@/security/secretsManager';
import { runInAiExecutionContext } from '@/security/secretsGuard';
import { sanitizeAiText } from '@/security/aiSanitizer';
import { PromptInjectionError, assertPromptSafe } from '@/security/promptGuard';

export const runtime = 'nodejs';

const BodySchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required'),
  // sourceButton: must be "research" when called from the Research panel.
  // Any other value is accepted but TinyFish remains hard-blocked regardless.
  sourceButton: z.enum(['research', 'general', 'task']).optional(),
});

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  throw new Error('Model returned no JSON object');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pickValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed));
    }
  }

  return undefined;
}

function toBool(value: unknown): boolean {
  return value === true;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function textFallbackFromRaw(rawText: string): string {
  const cleaned = rawText
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  return cleaned;
}

function parseGeminiResearchResponse(rawText: string): GeminiResearchResult {
  let record: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(extractJsonText(rawText)) as unknown;
    if (typeof parsed === 'string') {
      record = { answer: parsed };
    } else {
      record = asRecord(parsed);
    }
  } catch {
    record = { answer: textFallbackFromRaw(rawText) };
  }

  const answer = toStringValue(
    pickValue(record, ['answer', 'final_answer', 'response', 'responseText', 'response_text', 'text', 'output']),
  );

  return {
    answer,
    confidence: toNumberValue(pickValue(record, ['confidence'])),
    incomplete: toBool(pickValue(record, ['incomplete', 'is_incomplete'])),
    missingInfo: toStringArray(pickValue(record, ['missingInfo', 'missing_info'])),
    metadata: {
      source: 'gemini',
    },
  };
}

function parseClaudeResearchResponse(rawText: string): ClaudeResearchResult {
  let record: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(extractJsonText(rawText)) as unknown;
    if (typeof parsed === 'string') {
      record = { answer: parsed };
    } else {
      record = asRecord(parsed);
    }
  } catch {
    record = { answer: textFallbackFromRaw(rawText) };
  }

  const requestedBrowsing = toBool(pickValue(record, ['requiresBrowsing', 'requires_browsing']));
  const answer = toStringValue(
    pickValue(record, ['answer', 'final_answer', 'response', 'responseText', 'response_text', 'text', 'output']),
  );

  return {
    answer,
    confidence: toNumberValue(pickValue(record, ['confidence'])),
    incomplete: toBool(pickValue(record, ['incomplete', 'is_incomplete'])),
    missingInfo: toStringArray(pickValue(record, ['missingInfo', 'missing_info'])),
    requiresBrowsing: false,
    metadata: {
      source: 'claude',
      requestedBrowsing,
      browsingBlockedInResearchChat: requestedBrowsing,
    },
  };
}

function geminiPrompt(question: string): string {
  return [
    'You are Gemini handling research chat for Agent Wallet.',
    'Return valid JSON only with this exact schema:',
    '{"answer":"string","confidence":0.0,"incomplete":false,"missingInfo":[]}',
    'Rules:',
    '- Focus on information gathering, comparisons, recommendations, and explanations.',
    '- Do not mention browser automation or TinyFish.',
    '- confidence must be between 0 and 1.',
    `User question: ${question}`,
  ].join('\n');
}

function claudePrompt(input: {
  question: string;
  geminiResult: GeminiResearchResult;
  escalationReasons: string[];
  confidenceThreshold: number;
}): string {
  return [
    'You are Claude fallback for ResearchChat in Agent Wallet.',
    'Return valid JSON only with this exact schema:',
    '{"answer":"string","confidence":0.0,"incomplete":false,"missingInfo":[],"requiresBrowsing":false}',
    'Rules:',
    '- This surface is research-only: set requiresBrowsing=false.',
    '- Improve completeness and quality when Gemini confidence is low or incomplete.',
    '- Do not output browser execution steps.',
    `Confidence threshold: ${input.confidenceThreshold.toFixed(2)}`,
    `Escalation reasons: ${JSON.stringify(input.escalationReasons)}`,
    `Gemini result: ${JSON.stringify(input.geminiResult)}`,
    `User question: ${input.question}`,
  ].join('\n');
}

async function runGeminiResearch(question: string): Promise<GeminiResearchResult> {
  const apiKey = getSecretFromAny(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);

  const { raw, model } = await callGeminiGenerateContent({
    apiKey,
    operation: 'research chat',
    contents: [
      {
        role: 'user',
        parts: [{ text: geminiPrompt(question) }],
      },
    ],
    temperature: 0.2,
    maxOutputTokens: 800,
  });

  const parsed = parseGeminiResearchResponse(raw);
  return {
    ...parsed,
    metadata: {
      ...(parsed.metadata || {}),
      model,
    },
  };
}

async function runClaudeFallback(input: {
  question: string;
  geminiResult: GeminiResearchResult;
  escalationReasons: string[];
  confidenceThreshold: number;
}): Promise<ClaudeResearchResult> {
  const apiKey = getSecretFromAny(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);

  const { raw, model } = await callClaudeMessagesApi({
    apiKey,
    operation: 'research chat fallback',
    maxTokens: 1000,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: claudePrompt(input),
      },
    ],
  });

  const parsed = parseClaudeResearchResponse(raw);
  return {
    ...parsed,
    metadata: {
      ...(parsed.metadata || {}),
      model,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    return await runInAiExecutionContext(async () => {
      const { prompt, sourceButton } = BodySchema.parse(await req.json());
      assertPromptSafe(prompt, 'api.ai.research-chat.prompt');
      const safePrompt = sanitizeAiText(prompt);

      const classifiedType = classifyRequest(safePrompt);

      // Hard guard: TinyFish is unconditionally forbidden in the research pipeline.
      // Log routing metadata for observability.
      logServerEvent('info', 'ai.research_chat.routing', {
        sourceButton: sourceButton ?? 'unset',
        classifiedRequestType: classifiedType,
        tinyfishBlocked: true,
      });

      // Force 'research' pipeline regardless of classifier output. The
      // sourceButton from the frontend is the authoritative gate — when the
      // user clicks Research, we ALWAYS run the full Gemini→Claude chain and
      // never fall into a task or general fast-path.
      const result = await routeRequest({
        question: safePrompt,
        confidenceThreshold: 0.75,
        requestTypeOverride: 'research',
        gemini: async ({ question }) => {
          try {
            return await runGeminiResearch(question);
          } catch (error) {
            return {
              answer: '',
              confidence: 0,
              incomplete: true,
              missingInfo: [error instanceof Error ? error.message : 'gemini_failed'],
              metadata: { source: 'gemini', failed: true },
            };
          }
        },
        claude: async ({ question, geminiResult, escalationReasons, confidenceThreshold }) => {
          try {
            return await runClaudeFallback({
              question,
              geminiResult,
              escalationReasons,
              confidenceThreshold,
            });
          } catch (error) {
            return {
              answer: geminiResult.answer || 'I could not complete fallback reasoning right now.',
              confidence: geminiResult.confidence ?? 0.45,
              incomplete: true,
              missingInfo: [error instanceof Error ? error.message : 'claude_failed'],
              requiresBrowsing: false,
              metadata: { source: 'claude', failed: true },
            };
          }
        },
      });

      if (result.provider === 'tinyfish') {
        // Should never reach here given router config, but belt-and-suspenders.
        logServerEvent('error', 'ai.research_chat.tinyfish_leak', {
          sourceButton: sourceButton ?? 'unset',
          classifiedRequestType: classifiedType,
        });
        throw new Error('POLICY_VIOLATION: TinyFish is disabled for ResearchChat.');
      }

      logServerEvent('info', 'ai.research_chat.completed', {
        provider: result.provider,
        classifiedRequestType: classifiedType,
        confidence: result.confidence,
        usedTinyFish: false,
      });

      const safeAnswer = result.answer.trim();
      const answer = safeAnswer || 'I could not generate a complete answer this time. Please try again with a bit more detail.';
      const confidence = safeAnswer ? result.confidence : Math.max(result.confidence, 0.35);

      return NextResponse.json({
        ok: true,
        answer,
        provider: result.provider,
        requestType: result.requestType,
        classifiedRequestType: classifiedType,
        confidence,
        usedTinyFish: false,
      });
    });
  } catch (error) {
    if (error instanceof PromptInjectionError) {
      return NextResponse.json(apiError('POLICY_FAILURE', error.message, true), { status: error.status });
    }

    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Research chat request failed';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'ai.research_chat.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
