import { NextRequest } from 'next/server';
import { handleGoogleOAuthLogin } from '@/auth/oauth/googleOAuthController';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handleGoogleOAuthLogin(request);
}
