import 'server-only';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const DEFAULT_GEMINI_MODEL_FALLBACKS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
] as const;

type GeminiPart = {
  text: string;
};

type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

export type CallGeminiGenerateContentParams = {
  apiKey: string;
  operation: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
};

function parseModelList(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveGeminiModelCandidates(): string[] {
  const configuredModel = String(process.env.GEMINI_MODEL || '').trim();
  const configuredFallbacks = parseModelList(process.env.GEMINI_MODEL_FALLBACKS);

  const ordered = [
    configuredModel,
    ...configuredFallbacks,
    ...DEFAULT_GEMINI_MODEL_FALLBACKS,
  ].filter(Boolean);

  return Array.from(new Set(ordered));
}

function extractCandidateText(raw: string): string {
  const parsed = JSON.parse(raw) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const text = parsed.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Gemini returned empty content');
  }

  return text;
}

export async function callGeminiGenerateContent(
  params: CallGeminiGenerateContentParams,
): Promise<{ raw: string; model: string }> {
  const models = resolveGeminiModelCandidates();

  if (models.length === 0) {
    throw new Error('No Gemini model candidates configured');
  }

  let lastErrorRaw = '';

  for (const model of models) {
    const endpoint = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

    const completion = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contents: params.contents,
        generationConfig: {
          temperature: params.temperature ?? 0.2,
          maxOutputTokens: params.maxOutputTokens ?? 800,
          responseMimeType: 'application/json',
        },
      }),
      cache: 'no-store',
    });

    const raw = await completion.text();
    if (completion.ok) {
      try {
        const candidateText = extractCandidateText(raw);
        return { raw: candidateText, model };
      } catch (error) {
        lastErrorRaw = error instanceof Error ? error.message : String(error);
        continue;
      }
    }

    if (completion.status === 404 || completion.status === 400) {
      lastErrorRaw = raw;
      continue;
    }

    throw new Error(
      `Gemini ${params.operation} failed (${completion.status}, model=${model}): ${raw.slice(0, 280)}`,
    );
  }

  throw new Error(
    `Gemini ${params.operation} failed: no configured model was available. Tried: ${models.join(', ')}. ${lastErrorRaw.slice(0, 220)}`,
  );
}
