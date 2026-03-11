import { NextResponse } from 'next/server';
import { getWalletUserId } from '@/lib/server/ledger';
import { loadSessionSnapshot, saveSessionSnapshot } from '@/lib/server/memory';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await getWalletUserId();
    const snapshot = await loadSessionSnapshot(userId);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load session';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'memory.get.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getWalletUserId();
    const body = await request.json();

    await saveSessionSnapshot(userId, {
      messages: body.messages,
      activeTask: body.activeTask,
      liveRun: body.liveRun,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save session';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'memory.post.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
