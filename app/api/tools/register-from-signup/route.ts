import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import {
  registerToolFromSignup,
  type ToolConnectionType,
  type ToolSecretType,
} from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const BodySchema = z.object({
  toolKey: z.string().trim().min(1),
  displayName: z.string().trim().optional(),
  category: z.string().trim().optional(),
  homepageUrl: z.string().trim().optional(),
  loginUrl: z.string().trim().optional(),
  signupUrl: z.string().trim().optional(),
  loginIdentifier: z.string().trim().optional(),
  secret: z.unknown(),
  secretType: z.enum(['password', 'oauth_token', 'refresh_token', 'api_key', 'session']).optional(),
  connectionType: z.enum(['password', 'oauth', 'api_key', 'session']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function secretLooksEmpty(secret: unknown): boolean {
  if (secret === null || secret === undefined) return true;
  if (typeof secret === 'string') return secret.trim().length === 0;
  if (Array.isArray(secret)) return secret.length === 0;
  if (typeof secret === 'object') return Object.keys(secret).length === 0;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    if (secretLooksEmpty(body.secret)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', 'A secret value is required', true), { status: 400 });
    }

    const userId = getWalletUserId();
    const connected = await registerToolFromSignup({
      userId,
      toolKey: body.toolKey,
      displayName: body.displayName,
      category: body.category || null,
      homepageUrl: body.homepageUrl || null,
      loginUrl: body.loginUrl || null,
      signupUrl: body.signupUrl || null,
      loginIdentifier: body.loginIdentifier,
      secret: body.secret,
      secretType: body.secretType as ToolSecretType | undefined,
      connectionType: body.connectionType as ToolConnectionType | undefined,
      metadata: body.metadata || null,
    });

    logServerEvent('info', 'tools.signup_register.success', {
      userId,
      userToolId: connected.id,
      toolKey: connected.tool.key,
    });

    return NextResponse.json({
      ok: true,
      tool: connected,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to register signup tool';
    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'tools.signup_register.failed', {
      status,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
