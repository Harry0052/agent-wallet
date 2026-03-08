import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { getProcurementTask, updateProcurementTask } from '@/lib/server/procurement';
import { runProcurementResearchTask } from '@/lib/server/procurementResearchRunner';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const StartSchema = z.object({
  taskId: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const { taskId } = StartSchema.parse(await req.json());
    const userId = getWalletUserId();
    logServerEvent('info', 'procurement.research.start.requested', { userId, taskId });

    const task = await getProcurementTask({ taskId, userId });
    if (!task) {
      return NextResponse.json(apiError('NOT_FOUND', 'Procurement task not found', true), { status: 404 });
    }

    if (task.status === 'needs_clarification') {
      return NextResponse.json(
        apiError('INVALID_STATE', 'Task requires clarification before research can run', true),
        { status: 409 },
      );
    }

    if (task.status === 'researching') {
      logServerEvent('info', 'procurement.research.start.idempotent', { userId, taskId, status: task.status });
      return NextResponse.json({ ok: true, started: false, task });
    }

    if (task.status === 'researched' && task.findings) {
      logServerEvent('info', 'procurement.research.start.idempotent', { userId, taskId, status: task.status });
      return NextResponse.json({ ok: true, started: false, task });
    }

    const allowedRetryStates: Array<typeof task.status> = ['planned', 'failed', 'researched'];
    if (!allowedRetryStates.includes(task.status)) {
      return NextResponse.json(
        apiError('INVALID_STATE', `Research cannot start while task is in ${task.status} state`, true),
        { status: 409 },
      );
    }

    void runProcurementResearchTask({ userId, taskId }).catch(async (error) => {
      try {
        const current = await getProcurementTask({ taskId, userId });
        if (!current) return;

        await updateProcurementTask({
          taskId,
          userId,
          status: 'failed',
          goal: current.goal,
          budgetLimit: current.budgetLimit,
          category: current.category,
          targetVendors: current.targetVendors,
          comparisonCriteria: current.comparisonCriteria,
          mustHaveFeatures: current.mustHaveFeatures,
          findings: current.findings,
          recommendation: current.recommendation,
          planningOutput: current.planningOutput,
          error: `[TINYFISH_RESEARCH_FAILURE] ${error instanceof Error ? error.message : 'Procurement research failed'}`,
        });
      } catch (persistError) {
        logServerEvent('error', 'procurement.research.start.persist_failure', {
          userId,
          taskId,
          error: persistError instanceof Error ? persistError.message : String(persistError),
        });
      }

      logServerEvent('error', 'procurement.research.start.background_failed', {
        userId,
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    logServerEvent('info', 'procurement.research.start.accepted', { userId, taskId });
    return NextResponse.json({ ok: true, started: true, taskId });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to start procurement research';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'procurement.research.start.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
