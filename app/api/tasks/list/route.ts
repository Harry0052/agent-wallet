import { NextResponse } from 'next/server';
import { isAuthError } from '@/lib/server/auth';
import { getWalletUserId } from '@/lib/server/ledger';
import { listTasksForUser } from '@/lib/server/tasks';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await getWalletUserId();
    const tasks = await listTasksForUser({ userId, limit: 200 });
    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }

    const message = error instanceof Error ? error.message : 'Failed to list tasks';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'tasks.list.failed', { status: 500, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
