import { NextRequest } from 'next/server';
import { handleGoogleOAuthCallback } from '@/auth/oauth/googleOAuthController';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handleGoogleOAuthCallback(request);
}
