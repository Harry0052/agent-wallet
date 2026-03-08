import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId, listWebActionsForTask } from '@/lib/server/ledger';
import { getProcurementTask, listProcurementFindings } from '@/lib/server/procurement';
import type { ProcurementLifecycleState, ProcurementResearchLog, ProcurementTaskRecord } from '@/lib/types';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  taskId: z.string().trim().min(1),
  since: z.string().trim().optional(),
});

function toResearchLog(action: Awaited<ReturnType<typeof listWebActionsForTask>>[number]): ProcurementResearchLog {
  const details = action.details as Record<string, unknown> | undefined;
  const message = typeof details?.message === 'string'
    ? details.message
    : action.actionType;

  return {
    id: action.id,
    taskId: action.taskId,
    actionType: action.actionType,
    status: action.status,
    message,
    url: action.url,
    phase: typeof details?.phase === 'string' ? details.phase : undefined,
    event: typeof details?.event === 'string' ? details.event : undefined,
    code: typeof details?.code === 'string' ? details.code : undefined,
    createdAt: action.createdAt,
  };
}

function lifecycleForTask(task: ProcurementTaskRecord): ProcurementLifecycleState {
  if (task.status === 'failed') {
    return {
      phase: 'failed',
      canRetry: true,
      retryHint: 'Retry the current phase after resolving the blocker in logs/error details.',
    };
  }

  if (task.status === 'planning' || task.status === 'planned' || task.status === 'needs_clarification') {
    return {
      phase: 'planning',
      canRetry: task.status !== 'needs_clarification',
      retryHint: task.status === 'needs_clarification' ? 'Answer clarification questions and re-submit planning.' : 'Re-run planning safely.',
    };
  }

  if (task.status === 'researching' || task.status === 'researched') {
    return {
      phase: 'researching',
      canRetry: true,
      retryHint: 'Re-run live research if TinyFish failed or data is stale.',
    };
  }

  if (task.status === 'comparing') {
    return {
      phase: 'comparing',
      canRetry: false,
      retryHint: 'Comparison is currently in progress.',
    };
  }

  if (task.status === 'awaiting_approval' || task.status === 'rejected') {
    return {
      phase: 'approval',
      canRetry: task.status === 'rejected',
      retryHint: task.status === 'rejected' ? 'Re-approve to continue purchase preparation.' : 'Approve or reject to continue.',
    };
  }

  if (task.status === 'purchase_preparing' || task.status === 'purchase_prepared') {
    return {
      phase: 'purchase_prep',
      canRetry: task.status === 'purchase_prepared',
      retryHint: task.status === 'purchase_prepared' ? 'Proceed to subscription operations or re-run prep if needed.' : 'Purchase preparation is running.',
    };
  }

  return {
    phase: 'planning',
    canRetry: true,
  };
}

export async function GET(req: NextRequest) {
  try {
    const raw = {
      taskId: req.nextUrl.searchParams.get('taskId') || '',
      since: req.nextUrl.searchParams.get('since') || undefined,
    };

    const params = QuerySchema.parse(raw);
    const userId = getWalletUserId();

    const task = await getProcurementTask({ taskId: params.taskId, userId });
    if (!task) {
      return NextResponse.json(apiError('NOT_FOUND', 'Procurement task not found', true), { status: 404 });
    }

    const [findings, logs] = await Promise.all([
      listProcurementFindings({ taskId: task.id, userId }),
      listWebActionsForTask({
        userId,
        taskId: task.id,
        since: params.since,
        limit: 200,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      task,
      lifecycle: lifecycleForTask(task),
      findings,
      logs: logs.map(toResearchLog),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to load research status';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'procurement.status.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
