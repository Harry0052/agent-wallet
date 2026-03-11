import type { NextRequest } from 'next/server';

export function extractRequestMeta(request: NextRequest): {
  ip: string | null;
  userAgent: string | null;
} {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor
    ? forwardedFor.split(',')[0]?.trim() || null
    : request.headers.get('x-real-ip') || null;

  return {
    ip,
    userAgent: request.headers.get('user-agent') || null,
  };
}
