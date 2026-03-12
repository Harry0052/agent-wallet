import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseAgentIntent } from '@/lib/server/agentIntent';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { sanitizeAiText } from '@/security/aiSanitizer';
import { PromptInjectionError, assertPromptSafe } from '@/security/promptGuard';

export const runtime = 'nodejs';

const BodySchema = z.object({
  message: z.string().trim().min(1, 'message is required'),
});

export async function POST(req: NextRequest) {
  try {
    await requireAuthenticatedUser();
    const body = BodySchema.parse(await req.json());
    assertPromptSafe(body.message, 'api.agent.intent.message');
    const intent = await parseAgentIntent(sanitizeAiText(body.message));
    return NextResponse.json({
      ok: true,
      intent,
    });
  } catch (error) {
    if (error instanceof PromptInjectionError) {
      return NextResponse.json(
        apiError('POLICY_FAILURE', error.message, true),
        { status: error.status },
      );
    }

    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to parse agent intent';

    const status = error instanceof z.ZodError
      ? 400
      : message.includes('Claude') || message.includes('ANTHROPIC')
        ? 502
        : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'agent.intent.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
