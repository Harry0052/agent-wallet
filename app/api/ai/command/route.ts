import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceEntitlement } from '@/security/entitlementGuard';
import { processCommand } from '@/lib/server/engines/commandEngine';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { validateJsonBody } from '@/security/requestValidator';
import { assertPromptSafe } from '@/security/promptGuard';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CommandSchema = z.object({
  input: z.string().trim().min(1, 'input is required').max(2000, 'input exceeds 2000 characters'),
});

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'ai', scope: 'ai_command' });
  if (rateLimited) return rateLimited;

  const guard = await enforceEntitlement(req, {
    requiredFeature: 'ai_research',
    rateLimitScope: 'ai_command',
  });
  if (!guard.ok) return guard.response;

  try {
    const body = await validateJsonBody(req, CommandSchema);
    assertPromptSafe(body.input, 'ai.command');
    const result = await processCommand(guard.ctx.auth.walletUserId, body.input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : 'Command processing failed';
    const errorCode = classifyTaskError({ message: rawMessage });
    logServerEvent('error', 'ai.command.failed', { errorCode, message: rawMessage });
    const clientMessage = /database|pool|connection|timeout|internal/i.test(rawMessage)
      ? 'Service temporarily unavailable. Please try again.'
      : rawMessage;
    return NextResponse.json(apiError(errorCode, clientMessage, true), { status: 500 });
  }
}
