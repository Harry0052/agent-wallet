import { NextResponse } from 'next/server';
import { listToolsCatalog } from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const catalog = await listToolsCatalog();
    return NextResponse.json({ ok: true, catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load tools catalog';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'tools.catalog.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
