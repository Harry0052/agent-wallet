import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { getActionJournal } from '@/lib/server/automation/store';
import { isAuthError } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'task_journal' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;

    const limitParam = req.nextUrl.searchParams.get('limit');
    const offsetParam = req.nextUrl.searchParams.get('offset');

    const limit = limitParam ? Math.max(1, Math.min(parseInt(limitParam, 10) || 20, 200)) : 20;
    const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0;

    logServerEvent('info', 'tasks.journal.get', {
      userId,
      limit,
      offset,
    });

    const journal = await getActionJournal(userId, { limit, offset });

    return NextResponse.json({
      ok: true,
      journal,
      pagination: {
        limit,
        offset,
        count: journal.length,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.message, true),
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to load action journal.';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'tasks.journal.failed', {
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
