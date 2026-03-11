import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import {
  getCandidateSourcingTaskById,
  listCandidateSourcingLogs,
} from '@/lib/server/sourcingTaskStore';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({
  taskId: z.string().trim().min(1),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  const userId = await getWalletUserId();

  try {
    const params = ParamsSchema.parse(await context.params);

    const task = await getCandidateSourcingTaskById({
      userId,
      taskId: params.taskId,
    });

    if (!task) {
      return NextResponse.json(apiError('NOT_FOUND', 'Sourcing task not found', true), {
        status: 404,
      });
    }

    const logs = await listCandidateSourcingLogs({
      userId,
      taskId: task.id,
      limit: 400,
    });

    return NextResponse.json({
      ok: true,
      task,
      logs,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to load sourcing task detail';

    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'sourcing.tasks.detail.failed', {
      userId,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}
