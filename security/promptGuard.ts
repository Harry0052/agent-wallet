import 'server-only';

export class PromptInjectionError extends Error {
  status: number;
  patterns: string[];

  constructor(message: string, patterns: string[], status = 400) {
    super(message);
    this.name = 'PromptInjectionError';
    this.status = status;
    this.patterns = patterns;
  }
}

const PROMPT_INJECTION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'ignore_previous_instructions', regex: /\bignore\s+(?:all\s+)?previous\s+instructions?\b/i },
  { label: 'reveal_system_prompt', regex: /\breveal\s+(?:the\s+)?system\s+prompt\b/i },
  { label: 'show_hidden_data', regex: /\bshow\s+hidden\s+data\b/i },
  { label: 'print_system_prompt', regex: /\b(?:print|display|show)\s+(?:the\s+)?system\s+prompt\b/i },
  { label: 'bypass_guardrails', regex: /\b(?:bypass|disable|override)\s+(?:safety|guardrails?|restrictions?)\b/i },
] as const;

export function detectPromptInjection(input: string): {
  blocked: boolean;
  matchedPatterns: string[];
} {
  const text = String(input || '').trim();
  if (!text) {
    return {
      blocked: false,
      matchedPatterns: [],
    };
  }

  const matchedPatterns = PROMPT_INJECTION_PATTERNS
    .filter(({ regex }) => regex.test(text))
    .map(({ label }) => label);

  return {
    blocked: matchedPatterns.length > 0,
    matchedPatterns,
  };
}

export function assertPromptSafe(input: string, context = 'ai.prompt'): void {
  const detection = detectPromptInjection(input);
  if (!detection.blocked) return;

  console.warn('[SECURITY_ALERT] prompt injection pattern detected', {
    context,
    patterns: detection.matchedPatterns,
  });

  throw new PromptInjectionError(
    'Prompt injection patterns detected. Request blocked.',
    detection.matchedPatterns,
    400,
  );
}

