import type { AgentExecutionResult } from '@/lib/agent/types';
import type { AgentOrchestrationResult } from '@/lib/server/agentOrchestrator';
import { getProcurementTask } from '@/lib/server/procurement';
import { parseProcurementRecommendation } from '@/lib/server/procurementRecommendation';
import { createSubscriptionAction, listSubscriptionActions } from '@/lib/server/subscriptions';
import { runSubscriptionOperation } from '@/lib/server/subscriptionOperationRunner';
import {
  discoverTinyFishVendorCandidates,
  type TinyFishProcurementFinding,
  runTinyFishVendorPricingResearch,
} from '@/lib/server/tinyfishResearch';

async function runProcurementExecution(params: {
  orchestration: AgentOrchestrationResult;
}): Promise<AgentExecutionResult> {
  const goal = params.orchestration.procurement?.goal || params.orchestration.message;
  const budgetLimit = params.orchestration.intent.budget_limit;

  let candidates: string[] = [];
  try {
    candidates = await discoverTinyFishVendorCandidates({
      goal,
      maxCandidates: 5,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'vendor discovery failed';
    return {
      status: 'failed',
      message: `Live vendor discovery is temporarily unavailable: ${reason}. Try again in a minute.`,
      candidates: [],
    };
  }

  const researchTargets = candidates.slice(0, 3);
  const findings: TinyFishProcurementFinding[] = [];

  for (const vendor of researchTargets) {
    try {
      const research = await runTinyFishVendorPricingResearch({
        vendor,
        goal,
        budgetLimit,
        mustHaveFeatures: [],
        comparisonCriteria: ['price', 'fit', 'billing flexibility'],
        taskId: params.orchestration.taskId,
      });
      findings.push(...research.findings);
    } catch {
      // Continue researching other candidates; partial results are still useful.
    }
  }

  if (findings.length === 0) {
    return {
      status: 'failed',
      message: 'TinyFish could not extract usable pricing findings for this request.',
      candidates: researchTargets,
    };
  }

  const ranked = [...findings].sort((a, b) => {
    if (a.monthlyPrice === null && b.monthlyPrice === null) return 0;
    if (a.monthlyPrice === null) return 1;
    if (b.monthlyPrice === null) return -1;
    return a.monthlyPrice - b.monthlyPrice;
  });

  return {
    status: 'success',
    message: `TinyFish researched ${researchTargets.length} vendors and found ${findings.length} plans.`,
    candidates: researchTargets,
    topMatches: ranked.slice(0, 5),
  };
}

async function runCancellationExecution(params: {
  userId: string;
  orchestration: AgentOrchestrationResult;
}): Promise<AgentExecutionResult> {
  const target = params.orchestration.cancelSubscription;
  if (!target?.taskId) {
    return {
      status: 'needs_input',
      message: 'Missing subscription task target for cancellation.',
    };
  }

  const task = await getProcurementTask({
    taskId: target.taskId,
    userId: params.userId,
  });

  if (!task) {
    return {
      status: 'failed',
      message: `Subscription task not found: ${target.taskId}.`,
    };
  }

  const recommendation = parseProcurementRecommendation(task.recommendation);
  if (!recommendation?.winner || recommendation.approval?.decision !== 'approved') {
    return {
      status: 'failed',
      message: 'Subscription cancellation requires an approved procurement winner.',
    };
  }

  const recent = await listSubscriptionActions({
    userId: params.userId,
    taskId: target.taskId,
    limit: 16,
  });
  const running = recent.find((action) => action.status === 'running' && action.operation === 'cancel');
  if (running) {
    return {
      status: 'queued',
      message: `Cancellation is already running for ${target.vendorName}.`,
      started: false,
      actionId: running.id,
      taskId: target.taskId,
    };
  }

  const action = await createSubscriptionAction({
    userId: params.userId,
    taskId: target.taskId,
    operation: 'cancel',
  });

  void runSubscriptionOperation({
    userId: params.userId,
    actionId: action.id,
  });

  return {
    status: 'queued',
    message: `Cancellation workflow started for ${target.vendorName}.`,
    started: true,
    actionId: action.id,
    taskId: target.taskId,
  };
}

export async function runTinyFishTask(params: {
  userId: string;
  orchestration: AgentOrchestrationResult;
}): Promise<AgentExecutionResult> {
  if (!process.env.TINYFISH_API_KEY) {
    return {
      status: 'failed',
      message: 'TINYFISH_API_KEY is not configured.',
    };
  }

  try {
    if (params.orchestration.route === 'cancel_subscription') {
      return runCancellationExecution(params);
    }

    if (params.orchestration.route === 'procurement_task') {
      return runProcurementExecution(params);
    }

    if (params.orchestration.route === 'signup_and_prepare_checkout') {
      return {
        status: 'queued',
        message: 'Signup and checkout preparation is queued in the procurement workflow.',
        merchant: params.orchestration.signup?.merchant || null,
      };
    }

    return {
      status: 'noop',
      message: `No TinyFish action for route ${params.orchestration.route}.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'TinyFish execution failed';
    return {
      status: 'failed',
      message: `TinyFish execution failed: ${reason}`,
    };
  }
}
