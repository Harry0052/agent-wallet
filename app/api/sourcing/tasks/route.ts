import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { listCandidateSourcingTasks } from '@/lib/server/sourcingTaskStore';
import { startCandidateSourcingTask } from '@/lib/server/candidateSourcingRunner';
import { toSourcingDashboardCard } from '@/lib/sourcing/dashboard';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const PostBodySchema = z.object({
  action: z.enum(['retry']),
  taskId: z.string().trim().min(1),
});

function toSummary(tasks: Awaited<ReturnType<typeof listCandidateSourcingTasks>>) {
  const counts = {
    queued: 0,
    running: 0,
    parsing: 0,
    scoring: 0,
    exporting: 0,
    completed: 0,
    failed: 0,
    partial_success: 0,
  };

  for (const task of tasks) {
    counts[task.status] += 1;
  }

  return counts;
}

export async function GET(req: NextRequest) {
  const userId = await getWalletUserId();

  try {
    const parsed = QuerySchema.parse({
      limit: req.nextUrl.searchParams.get('limit') || undefined,
    });

    const tasks = await listCandidateSourcingTasks({
      userId,
      limit: parsed.limit,
    });

    const records = tasks.map(toSourcingDashboardCard);

    return NextResponse.json({
      ok: true,
      summary: toSummary(tasks),
      records,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to load sourcing tasks';

    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'sourcing.tasks.list.failed', {
      userId,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getWalletUserId();

  try {
    const body = PostBodySchema.parse(await req.json());

    const result = await startCandidateSourcingTask({
      userId,
      taskId: body.taskId,
    });

    return NextResponse.json({
      ok: true,
      result,
      at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to process sourcing action';

    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'sourcing.tasks.action.failed', {
      userId,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}
