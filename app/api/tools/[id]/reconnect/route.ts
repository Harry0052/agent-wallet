import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import {
  reconnectToolForUser,
  type ToolConnectionType,
  type ToolSecretType,
} from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const BodySchema = z.object({
  secret: z.unknown(),
  secretType: z.enum(['password', 'oauth_token', 'refresh_token', 'api_key', 'session']).optional(),
  connectionType: z.enum(['password', 'oauth', 'api_key', 'session']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  loginIdentifier: z.string().trim().optional(),
  label: z.string().trim().optional(),
});

function secretLooksEmpty(secret: unknown): boolean {
  if (secret === null || secret === undefined) return true;
  if (typeof secret === 'string') return secret.trim().length === 0;
  if (Array.isArray(secret)) return secret.length === 0;
  if (typeof secret === 'object') return Object.keys(secret).length === 0;
  return false;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = BodySchema.parse(await req.json());
    if (secretLooksEmpty(body.secret)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', 'A secret value is required', true), { status: 400 });
    }

    const userId = getWalletUserId();
    const tool = await reconnectToolForUser({
      userId,
      userToolId: id,
      secret: body.secret,
      secretType: body.secretType as ToolSecretType | undefined,
      connectionType: body.connectionType as ToolConnectionType | undefined,
      metadata: body.metadata || null,
      loginIdentifier: body.loginIdentifier,
      label: body.label,
    });

    return NextResponse.json({ ok: true, tool });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to reconnect tool';
    const status = error instanceof z.ZodError
      ? 400
      : message.toLowerCase().includes('not found')
        ? 404
        : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'tools.reconnect.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
