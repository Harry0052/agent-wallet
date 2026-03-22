import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  AuthError,
  isAuthError,
  requireAuthenticatedUser,
  type AuthenticatedUser,
} from '@/lib/server/auth';
import { getOptionalSecret } from '@/security/secretsManager';

export type ApiRole = 'user' | 'admin';

export type AuthGuardContext = AuthenticatedUser & {
  role: ApiRole;
};

type RequireApiAuthOptions = {
  requiredRoles?: ApiRole[];
};

const ROLE_RANK: Record<ApiRole, number> = {
  user: 1,
  admin: 2,
};

function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAdminByOverrideHeader(request: NextRequest): boolean {
  const configured = getOptionalSecret('AUTH_ADMIN_OVERRIDE_TOKEN');
  if (!configured) return false;

  const provided = request.headers.get('x-agent-wallet-admin-token')?.trim();
  if (!provided) return false;
  return secureEqual(provided, configured);
}

function isAdminByEmail(email: string): boolean {
  const allowList = new Set([
    ...splitList(process.env.AUTH_ADMIN_EMAILS),
    ...splitList(process.env.ADMIN_EMAIL_ALLOWLIST),
  ]);

  if (allowList.size === 0) return false;
  return allowList.has(email.trim().toLowerCase());
}

function resolveRole(user: AuthenticatedUser, request: NextRequest): ApiRole {
  if (isAdminByOverrideHeader(request)) return 'admin';
  if (isAdminByEmail(user.email)) return 'admin';
  return 'user';
}

function hasRequiredRole(role: ApiRole, requiredRoles: ApiRole[]): boolean {
  return requiredRoles.some((required) => ROLE_RANK[role] >= ROLE_RANK[required]);
}

export async function requireApiAuth(
  request: NextRequest,
  options: RequireApiAuthOptions = {},
): Promise<AuthGuardContext> {
  const user = await requireAuthenticatedUser();
  const expiresAtMs = Date.parse(user.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new AuthError('Session token expired.', 401);
  }

  const role = resolveRole(user, request);
  const requiredRoles: ApiRole[] = options.requiredRoles && options.requiredRoles.length > 0
    ? options.requiredRoles
    : ['user'];

  if (!hasRequiredRole(role, requiredRoles)) {
    throw new AuthError('Insufficient permissions for this endpoint.', 403);
  }

  return {
    ...user,
    role,
  };
}

export async function enforceApiAuth(
  request: NextRequest,
  options: RequireApiAuthOptions = {},
): Promise<
  | { ok: true; auth: AuthGuardContext }
  | { ok: false; response: NextResponse }
> {
  try {
    const auth = await requireApiAuth(request, options);
    return { ok: true, auth };
  } catch (error) {
    const response = toAuthErrorResponse(error);
    if (response) {
      return { ok: false, response };
    }
    // Handle non-auth errors (DB connection errors, pool exhaustion, etc.)
    // instead of rethrowing — prevents empty 500 responses on Vercel.
    const message = error instanceof Error ? error.message : 'Authentication service unavailable';
    console.error('[AUTH_GUARD] Non-auth error during authentication:', message);
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'Service temporarily unavailable. Please try again.', errorCode: 'SERVICE_UNAVAILABLE' },
        { status: 503 },
      ),
    };
  }
}

export function toAuthErrorResponse(error: unknown): NextResponse | null {
  if (!isAuthError(error)) return null;

  return NextResponse.json(
    {
      ok: false,
      error: error.message,
    },
    { status: error.status },
  );
}
