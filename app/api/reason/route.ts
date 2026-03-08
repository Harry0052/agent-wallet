import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type WalletInput = {
  balance?: number;
  settings?: {
    maxTransaction?: number;
    dailyLimit?: number;
    monthlyBudget?: number;
    approvalThreshold?: number;
    allowedMerchants?: string[];
    blockedMerchants?: string[];
  };
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { userMessage?: string; wallet?: WalletInput };
    const userMessage = (body.userMessage || '').trim();

    if (!userMessage) {
      return NextResponse.json({ error: 'userMessage is required' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 500 });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const guardrails = {
      balance: body.wallet?.balance ?? 0,
      maxTransaction: body.wallet?.settings?.maxTransaction ?? 50,
      dailyLimit: body.wallet?.settings?.dailyLimit ?? 100,
      monthlyBudget: body.wallet?.settings?.monthlyBudget ?? 500,
      approvalThreshold: body.wallet?.settings?.approvalThreshold ?? 10,
      allowedMerchants: body.wallet?.settings?.allowedMerchants ?? [],
      blockedMerchants: body.wallet?.settings?.blockedMerchants ?? [],
    };

    const prompt = [
      'You are the reasoning/planning layer for an autonomous procurement wallet.',
      'Return only valid JSON with this exact shape:',
      '{"intent":"buy|clarify|send|subscription|other","summary":"string","normalizedRequest":"string","searchQuery":"string","budgetMax":number,"needsClarification":boolean,"clarifyingQuestion":"string?","plan":["string"],"guardrailChecks":["string"],"rankingCriteria":["string"]}',
      'Rules:',
      '- Ask at most one clarification question and only when required.',
      '- Never fabricate vendor pricing or vendor facts.',
      '- Keep plan short (3-6 steps).',
      '- Budget cannot exceed maxTransaction or balance.',
      `Guardrails: ${JSON.stringify(guardrails)}`,
      `User request: ${userMessage}`,
    ].join('\n');

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You produce strictly valid JSON responses.' },
          { role: 'user', content: prompt },
        ],
      }),
      cache: 'no-store',
    });

    const responseText = await completion.text();
    if (!completion.ok) {
      return NextResponse.json(
        { error: `OpenAI reasoning request failed (${completion.status}): ${responseText.slice(0, 250)}` },
        { status: 502 },
      );
    }

    let parsedBody: { choices?: Array<{ message?: { content?: string } }> };
    try {
      parsedBody = JSON.parse(responseText) as { choices?: Array<{ message?: { content?: string } }> };
    } catch {
      return NextResponse.json({ error: 'OpenAI returned non-JSON response' }, { status: 502 });
    }

    const content = parsedBody.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: 'OpenAI returned empty reasoning content' }, { status: 502 });
    }

    let reasoning: unknown;
    try {
      reasoning = JSON.parse(content);
    } catch {
      return NextResponse.json({ error: 'OpenAI reasoning content was not valid JSON' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, source: 'openai', reasoning });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reasoning failed' },
      { status: 500 },
    );
  }
}
