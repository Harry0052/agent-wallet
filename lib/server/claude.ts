import 'server-only';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

const DEFAULT_CLAUDE_MODEL_FALLBACKS = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5',
] as const;

type ClaudeMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type CallClaudeMessagesApiParams = {
  apiKey: string;
  operation: string;
  maxTokens: number;
  temperature?: number;
  messages: ClaudeMessage[];
};

function parseModelList(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveClaudeModelCandidates(): string[] {
  const configuredModel = String(process.env.CLAUDE_MODEL || '').trim();
  const configuredFallbacks = parseModelList(process.env.CLAUDE_MODEL_FALLBACKS);

  const ordered = [
    configuredModel,
    ...configuredFallbacks,
    ...DEFAULT_CLAUDE_MODEL_FALLBACKS,
  ].filter(Boolean);

  return Array.from(new Set(ordered));
}

function isModelNotFound(status: number, raw: string): boolean {
  if (status !== 404) return false;
  const lower = raw.toLowerCase();
  return lower.includes('not_found_error')
    || (lower.includes('model') && lower.includes('not found'));
}

export async function callClaudeMessagesApi(
  params: CallClaudeMessagesApiParams,
): Promise<{ raw: string; model: string }> {
  const models = resolveClaudeModelCandidates();

  if (models.length === 0) {
    throw new Error('No Claude model candidates configured');
  }

  let lastNotFoundRaw = '';

  for (const model of models) {
    const completion = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0,
        messages: params.messages,
      }),
      cache: 'no-store',
    });

    const raw = await completion.text();
    if (completion.ok) {
      return { raw, model };
    }

    if (isModelNotFound(completion.status, raw)) {
      lastNotFoundRaw = raw;
      continue;
    }

    throw new Error(
      `Claude ${params.operation} failed (${completion.status}, model=${model}): ${raw.slice(0, 280)}`,
    );
  }

  throw new Error(
    `Claude ${params.operation} failed: no configured model was available. Tried: ${models.join(', ')}. ${lastNotFoundRaw.slice(0, 220)}`,
  );
}
