import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'funding' });
  if (rateLimited) return rateLimited;

  await requireAuthenticatedUser();
  return NextResponse.json(
    apiError('STRIPE_FAILURE', 'Deprecated endpoint. Balance updates are webhook-driven only.', true),
    { status: 410 },
  );
}
