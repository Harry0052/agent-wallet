import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { resolveRuntimeCredentialReference } from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const BodySchema = z.object({
  toolKey: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    const userId = getWalletUserId();
    const reference = await resolveRuntimeCredentialReference({
      userId,
      toolKey: body.toolKey,
    });

    const response = reference.resolved
      ? {
        resolved: true as const,
        tool: reference.tool,
        hasMetadata: reference.hasMetadata,
      }
      : {
        resolved: false as const,
        reason: reference.reason,
        tool: 'tool' in reference ? reference.tool : undefined,
      };

    return NextResponse.json({
      ok: true,
      ...response,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to resolve runtime credentials';
    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'tools.runtime_resolve.failed', {
      status,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
