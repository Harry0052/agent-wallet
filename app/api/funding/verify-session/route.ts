import { NextResponse } from 'next/server';
import { apiError } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json(
    apiError('STRIPE_FAILURE', 'Deprecated endpoint. Balance updates are webhook-driven only.', true),
    { status: 410 },
  );
}
