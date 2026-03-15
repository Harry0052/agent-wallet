import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { processCommand } from '@/lib/server/engines/commandEngine';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'ai_command' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  let body: { input?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (input.length === 0 || input.length > 2000) {
    return NextResponse.json(
      { ok: false, error: 'input must be a non-empty string (max 2000 chars)' },
      { status: 400 },
    );
  }

  try {
    const result = await processCommand(auth.auth.walletUserId, input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Command processing failed';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'ai.command.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
