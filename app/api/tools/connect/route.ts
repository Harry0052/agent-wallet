import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import {
  connectToolForUser,
  type ToolConnectionType,
  type ToolSecretType,
  type UserToolCreatedBy,
  type UserToolStatus,
} from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const BodySchema = z.object({
  toolKey: z.string().trim().optional(),
  displayName: z.string().trim().optional(),
  category: z.string().trim().optional(),
  iconName: z.string().trim().optional(),
  homepageUrl: z.string().trim().optional(),
  loginUrl: z.string().trim().optional(),
  signupUrl: z.string().trim().optional(),
  supportsOauth: z.boolean().optional(),
  supportsPasswordLogin: z.boolean().optional(),
  supportsApiKey: z.boolean().optional(),
  connectionType: z.enum(['password', 'oauth', 'api_key', 'session']),
  secretType: z.enum(['password', 'oauth_token', 'refresh_token', 'api_key', 'session']).optional(),
  secret: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  label: z.string().trim().optional(),
  loginIdentifier: z.string().trim().optional(),
  status: z.enum(['connected', 'disconnected', 'pending', 'failed']).optional(),
  enabled: z.boolean().optional(),
  createdBy: z.enum(['manual', 'signup_flow', 'oauth', 'imported']).optional(),
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
    const toolKey = body.toolKey || body.displayName;
    if (!toolKey || !toolKey.trim()) {
      return NextResponse.json(apiError('VALIDATION_ERROR', 'toolKey or displayName is required', true), { status: 400 });
    }

    if (secretLooksEmpty(body.secret)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', 'A secret value is required to connect a tool', true), { status: 400 });
    }

    const userId = getWalletUserId();
    const connected = await connectToolForUser({
      userId,
      toolKey,
      displayName: body.displayName,
      category: body.category || null,
      iconName: body.iconName || null,
      homepageUrl: body.homepageUrl || null,
      loginUrl: body.loginUrl || null,
      signupUrl: body.signupUrl || null,
      supportsOauth: body.supportsOauth,
      supportsPasswordLogin: body.supportsPasswordLogin,
      supportsApiKey: body.supportsApiKey,
      connectionType: body.connectionType as ToolConnectionType,
      secretType: body.secretType as ToolSecretType | undefined,
      secret: body.secret,
      metadata: body.metadata || null,
      label: body.label,
      loginIdentifier: body.loginIdentifier,
      status: body.status as UserToolStatus | undefined,
      enabled: body.enabled,
      createdBy: body.createdBy as UserToolCreatedBy | undefined,
    });

    logServerEvent('info', 'tools.connect.success', {
      userId,
      toolKey: connected.tool.key,
      userToolId: connected.id,
      connectionType: connected.connectionType,
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
        : 'Failed to connect tool';
    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'tools.connect.failed', {
      status,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
