import { classifyRequest, type ClassifiedRequestType } from '@/lib/ai/classifier';
import { validateTinyFishActivation } from '@/lib/ai/safeguards';

export const DEFAULT_RESEARCH_CONFIDENCE_THRESHOLD = 0.75;

export type RequestType = ClassifiedRequestType;

export interface ResearchModelResult {
  answer: string;
  confidence?: number | null;
  incomplete?: boolean;
  missingInfo?: string[];
  metadata?: Record<string, unknown>;
}

export interface GeminiResearchResult extends ResearchModelResult {}

export interface ClaudeResearchResult extends ResearchModelResult {
  requiresBrowsing: boolean;
}

export interface TinyFishResearchResult extends ResearchModelResult {}

export interface RouteRequestParams {
  question: string;
  confidenceThreshold?: number;
  /**
   * When set, overrides the internal classifier result. The sourceButton from
   * the frontend panel is the authoritative routing signal — e.g. the Research
   * panel forces 'research' so the full Gemini→Claude escalation chain always
   * runs, regardless of what the pattern-based classifier infers.
   */
  requestTypeOverride?: RequestType;
  gemini: (input: { requestType: RequestType; question: string }) => Promise<GeminiResearchResult>;
  claude: (input: {
    requestType: RequestType;
    question: string;
    geminiResult: GeminiResearchResult;
    confidenceThreshold: number;
    escalationReasons: string[];
  }) => Promise<ClaudeResearchResult>;
  tinyfish?: (input: {
    requestType: RequestType;
    question: string;
    claudeResult: ClaudeResearchResult;
  }) => Promise<TinyFishResearchResult>;
}

export interface RouteRequestResult {
  provider: 'gemini' | 'claude' | 'tinyfish';
  requestType: RequestType;
  classifiedRequestType: RequestType;
  warnings: string[];
  answer: string;
  confidence: number;
  incomplete: boolean;
  requiresBrowsing: boolean;
  usedTinyFish: boolean;
  threshold: number;
  gemini: GeminiResearchResult;
  claude?: ClaudeResearchResult;
  tinyfish?: TinyFishResearchResult;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RESEARCH_CONFIDENCE_THRESHOLD;
  }
  return clamp(value, 0, 1);
}

export function evaluateConfidence(confidence: number | null | undefined): number {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return 0;
  }
  return clamp(confidence, 0, 1);
}

export function evaluateCompleteness(result: ResearchModelResult): { incomplete: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const hasAnswer = typeof result.answer === 'string' && result.answer.trim().length > 0;
  if (!hasAnswer) {
    reasons.push('missing_answer');
  }

  if (result.incomplete === true) {
    reasons.push('explicit_incomplete');
  }

  if (Array.isArray(result.missingInfo) && result.missingInfo.length > 0) {
    reasons.push('missing_info');
  }

  return {
    incomplete: reasons.length > 0,
    reasons,
  };
}

export async function routeRequest(params: RouteRequestParams): Promise<RouteRequestResult> {
  const threshold = normalizeThreshold(params.confidenceThreshold);
  const classifiedRequestType = classifyRequest(params.question);

  // sourceButton override is the authoritative routing signal. When the user
  // clicks "Research", the pipeline MUST behave as research regardless of what
  // the pattern classifier thinks about the query text.
  const requestType = params.requestTypeOverride ?? classifiedRequestType;
  const warnings: string[] = [];

  const geminiResult = await params.gemini({
    requestType,
    question: params.question,
  });

  const geminiConfidence = evaluateConfidence(geminiResult.confidence);
  const geminiCompleteness = evaluateCompleteness(geminiResult);

  const isResearch = requestType === 'research';
  const shouldEscalateToClaude = isResearch && (
    geminiConfidence < threshold
    || geminiCompleteness.incomplete
  );

  if (!shouldEscalateToClaude) {
    return {
      provider: 'gemini',
      requestType,
      classifiedRequestType,
      warnings,
      answer: geminiResult.answer,
      confidence: geminiConfidence,
      incomplete: geminiCompleteness.incomplete,
      requiresBrowsing: false,
      usedTinyFish: false,
      threshold,
      gemini: geminiResult,
    };
  }

  const escalationReasons: string[] = [];
  if (geminiConfidence < threshold) {
    escalationReasons.push(
      `gemini_confidence_below_threshold:${geminiConfidence.toFixed(2)}<${threshold.toFixed(2)}`,
    );
  }
  escalationReasons.push(...geminiCompleteness.reasons);

  const claudeResult = await params.claude({
    requestType,
    question: params.question,
    geminiResult,
    confidenceThreshold: threshold,
    escalationReasons,
  });

  const claudeConfidence = evaluateConfidence(claudeResult.confidence);
  const claudeCompleteness = evaluateCompleteness(claudeResult);

  if (!claudeResult.requiresBrowsing) {
    return {
      provider: 'claude',
      requestType,
      classifiedRequestType,
      warnings,
      answer: claudeResult.answer,
      confidence: claudeConfidence,
      incomplete: claudeCompleteness.incomplete,
      requiresBrowsing: false,
      usedTinyFish: false,
      threshold,
      gemini: geminiResult,
      claude: claudeResult,
    };
  }

  if (!params.tinyfish) {
    throw new Error('Claude set requiresBrowsing=true but no TinyFish handler was configured.');
  }

  const tinyFishActivation = validateTinyFishActivation(requestType);
  if (!tinyFishActivation.allow) {
    if (tinyFishActivation.warning) warnings.push(tinyFishActivation.warning);
    return {
      provider: 'claude',
      requestType,
      classifiedRequestType,
      warnings,
      answer: claudeResult.answer,
      confidence: claudeConfidence,
      incomplete: claudeCompleteness.incomplete,
      requiresBrowsing: false,
      usedTinyFish: false,
      threshold,
      gemini: geminiResult,
      claude: claudeResult,
    };
  }

  const tinyFishResult = await params.tinyfish({
    requestType,
    question: params.question,
    claudeResult,
  });

  const tinyFishConfidence = evaluateConfidence(tinyFishResult.confidence);
  const tinyFishCompleteness = evaluateCompleteness(tinyFishResult);

  return {
    provider: 'tinyfish',
    requestType,
    classifiedRequestType,
    warnings,
    answer: tinyFishResult.answer,
    confidence: tinyFishConfidence,
    incomplete: tinyFishCompleteness.incomplete,
    requiresBrowsing: true,
    usedTinyFish: true,
    threshold,
    gemini: geminiResult,
    claude: claudeResult,
    tinyfish: tinyFishResult,
  };
}
