import { NextRequest } from 'next/server';
import { handleAppleOAuthLogin } from '@/auth/oauth/appleOAuthController';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handleAppleOAuthLogin(request);
}
