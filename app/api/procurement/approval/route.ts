import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId, recordApprovalDecision, recordWebAction } from '@/lib/server/ledger';
import { getProcurementTask, updateProcurementTask } from '@/lib/server/procurement';
import { parseProcurementRecommendation, recommendationAmount } from '@/lib/server/procurementRecommendation';
import { runProcurementPurchasePreparation } from '@/lib/server/procurementApprovalRunner';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const ApprovalSchema = z.object({
  taskId: z.string().trim().min(1),
  decision: z.enum(['approved', 'rejected']),
});

export async function POST(req: NextRequest) {
  try {
    const body = ApprovalSchema.parse(await req.json());
    const userId = getWalletUserId();
    logServerEvent('info', 'procurement.approval.requested', {
      userId,
      taskId: body.taskId,
      decision: body.decision,
    });

    const task = await getProcurementTask({ taskId: body.taskId, userId });
    if (!task) {
      return NextResponse.json(apiError('NOT_FOUND', 'Procurement task not found', true), { status: 404 });
    }

    const recommendation = parseProcurementRecommendation(task.recommendation);
    if (!recommendation || !recommendation.winner) {
      return NextResponse.json(
        apiError('INVALID_STATE', 'Recommendation winner is missing. Run evaluation before approval.', true),
        { status: 409 },
      );
    }

    const amountInfo = recommendationAmount(recommendation);
    const approvedAmount = amountInfo.amount ?? 0;

    if (body.decision === 'rejected') {
      if (task.status === 'purchase_preparing' || task.status === 'purchase_prepared') {
        return NextResponse.json(
          apiError('INVALID_STATE', `Cannot reject while task is in ${task.status} state`, true),
          { status: 409 },
        );
      }

      if (task.status === 'rejected' || recommendation.approval?.decision === 'rejected') {
        return NextResponse.json({
          ok: true,
          started: false,
          task,
          recommendation,
        });
      }

      await recordApprovalDecision({
        userId,
        taskId: task.id,
        amount: approvedAmount,
        currency: 'usd',
        decision: 'rejected',
        reason: 'User rejected procurement purchase preparation.',
      });

      const rejectedRecommendation = {
        ...recommendation,
        approval: {
          decision: 'rejected' as const,
          decidedAt: new Date().toISOString(),
        },
      };

      const updatedTask = await updateProcurementTask({
        taskId: task.id,
        userId: task.userId,
        status: 'rejected',
        goal: task.goal,
        budgetLimit: task.budgetLimit,
        category: task.category,
        targetVendors: task.targetVendors,
        comparisonCriteria: task.comparisonCriteria,
        mustHaveFeatures: task.mustHaveFeatures,
        findings: task.findings,
        recommendation: rejectedRecommendation as unknown as Record<string, unknown>,
        planningOutput: task.planningOutput,
        error: undefined,
      });

      await recordWebAction({
        userId,
        taskId: task.id,
        actionType: 'guardrail',
        status: 'done',
        details: {
          id: randomUUID(),
          phase: 'approval',
          event: 'approval_rejected',
          code: 'APPROVAL_REJECTED',
          message: 'approval rejected by user; purchase preparation stopped',
        },
        url: recommendation.winner.pricingPageUrl,
      });

      logServerEvent('info', 'procurement.approval.rejected', {
        userId,
        taskId: task.id,
      });

      return NextResponse.json({
        ok: true,
        started: false,
        task: updatedTask,
        recommendation: rejectedRecommendation,
      });
    }

    if (!recommendation.policy?.allowed) {
      return NextResponse.json(
        apiError('POLICY_FAILURE', recommendation.policy?.reason || 'Policy checks did not pass for this recommendation', true),
        { status: 409 },
      );
    }

    if (task.status === 'purchase_preparing' || task.status === 'purchase_prepared') {
      return NextResponse.json({
        ok: true,
        started: false,
        task,
        recommendation,
      });
    }

    const allowedStates: Array<typeof task.status> = ['awaiting_approval', 'researched', 'rejected', 'failed'];
    if (!allowedStates.includes(task.status)) {
      return NextResponse.json(
        apiError('INVALID_STATE', `Task cannot be approved while in ${task.status} state`, true),
        { status: 409 },
      );
    }

    await recordApprovalDecision({
      userId,
      taskId: task.id,
      amount: approvedAmount,
      currency: 'usd',
      decision: 'approved',
      reason: 'User approved procurement purchase preparation.',
    });

    const approvedRecommendation = {
      ...recommendation,
      approval: {
        decision: 'approved' as const,
        decidedAt: new Date().toISOString(),
      },
    };

    const updatedTask = await updateProcurementTask({
      taskId: task.id,
      userId: task.userId,
      status: 'purchase_preparing',
      goal: task.goal,
      budgetLimit: task.budgetLimit,
      category: task.category,
      targetVendors: task.targetVendors,
      comparisonCriteria: task.comparisonCriteria,
      mustHaveFeatures: task.mustHaveFeatures,
      findings: task.findings,
      recommendation: approvedRecommendation as unknown as Record<string, unknown>,
      planningOutput: task.planningOutput,
      error: undefined,
    });

    await recordWebAction({
      userId,
      taskId: task.id,
      actionType: 'guardrail',
      status: 'done',
      details: {
        id: randomUUID(),
        phase: 'approval',
        event: 'approval_granted',
        code: recommendation.policy.approvalRequired ? 'APPROVAL_REQUIRED_GRANTED' : 'APPROVAL_GRANTED',
        message: recommendation.policy.approvalRequired
          ? 'approval granted by user; starting purchase preparation'
          : 'policy passed and approval confirmed; starting purchase preparation',
      },
      url: recommendation.winner.pricingPageUrl,
    });

    void runProcurementPurchasePreparation({ userId, taskId: task.id }).catch(async (error) => {
      const message = error instanceof Error ? error.message : 'Purchase preparation failed';
      try {
        const current = await getProcurementTask({ taskId: task.id, userId });
        if (!current) return;

        const currentRecommendation = parseProcurementRecommendation(current.recommendation);
        const failedRecommendation = currentRecommendation
          ? {
            ...currentRecommendation,
            purchasePrep: {
              status: 'failed' as const,
              proofUrls: currentRecommendation.purchasePrep?.proofUrls || [],
              pendingLedgerEntry: currentRecommendation.purchasePrep?.pendingLedgerEntry,
              error: message,
            },
          }
          : current.recommendation;

        await updateProcurementTask({
          taskId: current.id,
          userId: current.userId,
          status: 'failed',
          goal: current.goal,
          budgetLimit: current.budgetLimit,
          category: current.category,
          targetVendors: current.targetVendors,
          comparisonCriteria: current.comparisonCriteria,
          mustHaveFeatures: current.mustHaveFeatures,
          findings: current.findings,
          recommendation: (failedRecommendation || null) as Record<string, unknown> | null,
          planningOutput: current.planningOutput,
          error: `[TINYFISH_RESEARCH_FAILURE] ${message}`,
        });
      } catch (persistError) {
        logServerEvent('error', 'procurement.approval.persist_failure', {
          userId,
          taskId: task.id,
          error: persistError instanceof Error ? persistError.message : String(persistError),
        });
      }

      logServerEvent('error', 'procurement.approval.background_failed', {
        userId,
        taskId: task.id,
        error: message,
      });
    });

    logServerEvent('info', 'procurement.approval.accepted', {
      userId,
      taskId: task.id,
    });

    return NextResponse.json({
      ok: true,
      started: true,
      task: updatedTask,
      recommendation: approvedRecommendation,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to submit procurement approval';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'procurement.approval.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
