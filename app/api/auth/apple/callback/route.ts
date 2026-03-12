import { NextRequest } from 'next/server';
import { handleAppleOAuthCallback } from '@/auth/oauth/appleOAuthController';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return handleAppleOAuthCallback(request);
}
