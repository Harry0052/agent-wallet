import type { AgentExecutionResult } from '@/lib/agent/types';
import type { AgentOrchestrationResult } from '@/lib/server/agentOrchestrator';
import { getProcurementTask } from '@/lib/server/procurement';
import { parseProcurementRecommendation } from '@/lib/server/procurementRecommendation';
import { createSubscriptionAction, listSubscriptionActions } from '@/lib/server/subscriptions';
import { runSubscriptionOperation } from '@/lib/server/subscriptionOperationRunner';
import { startCandidateSourcingTask } from '@/lib/server/candidateSourcingRunner';
import {
  discoverTinyFishVendorCandidates,
  type TinyFishProcurementFinding,
  runTinyFishVendorPricingResearch,
} from '@/lib/server/tinyfishResearch';
import {
  buildVendorClarificationQuestion,
  deriveVendorCandidatesFromContext,
  sanitizeVendorTargets,
} from '@/lib/server/vendorTargeting';
import { getRuntimeCredential } from '@/lib/server/toolsVault';
import { getOptionalSecret } from '@/security/secretsManager';

function fallbackDiscoveryCandidates(orchestration: AgentOrchestrationResult): string[] {
  const goal = orchestration.procurement?.goal || orchestration.message || '';
  const category = orchestration.intent.intent === 'compare_and_buy' ? 'compare_and_buy' : 'procurement';
  const inferredFromContext = deriveVendorCandidatesFromContext({
    goal,
    category,
    maxCandidates: 5,
  });

  return sanitizeVendorTargets([
    ...(orchestration.intent.candidate_vendors || []),
    orchestration.intent.merchant,
    orchestration.signup?.merchant || null,
    ...inferredFromContext,
  ]
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter((name): name is string => Boolean(name)), 5);
}

async function runProcurementExecution(params: {
  orchestration: AgentOrchestrationResult;
}): Promise<AgentExecutionResult> {
  const goal = params.orchestration.procurement?.goal || params.orchestration.message;
  const budgetLimit = params.orchestration.intent.budget_limit;
  const scopeLocked = params.orchestration.intent.scope_locked === true;
  const lockedCandidates = sanitizeVendorTargets(params.orchestration.intent.candidate_vendors || [], 5);
  let discoveryWarning: string | null = null;

  let candidates: string[] = [];
  if (scopeLocked) {
    candidates = lockedCandidates;
  } else {
    try {
      candidates = await discoverTinyFishVendorCandidates({
        goal,
        maxCandidates: 5,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'vendor discovery failed';
      const fallback = fallbackDiscoveryCandidates(params.orchestration);
      if (fallback.length === 0) {
        const clarification = buildVendorClarificationQuestion({
          goal,
          category: params.orchestration.intent.intent === 'compare_and_buy' ? 'compare_and_buy' : 'procurement',
        });
        return {
          status: 'needs_input',
          message: `Live vendor discovery is temporarily unavailable: ${reason}. ${clarification}`,
          candidates: [],
        };
      }
      candidates = fallback;
      discoveryWarning = reason;
    }
  }

  const researchTargets = candidates.slice(0, 3);
  if (scopeLocked && researchTargets.length === 0) {
    return {
      status: 'needs_input',
      message: 'I can keep this comparison scoped, but I need at least one vendor name. Which vendors should I compare?',
      candidates: [],
    };
  }

  const findings: TinyFishProcurementFinding[] = [];
  const vendorResearchFailures: string[] = [];

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
      vendorResearchFailures.push(vendor);
    }
  }

  if (findings.length === 0) {
    if (scopeLocked && researchTargets.length > 0) {
      return {
        status: 'needs_input',
        message: `I could not extract pricing for the scoped vendors (${researchTargets.join(', ')}). Do you want me to expand beyond those vendors?`,
        candidates: researchTargets,
        failedVendors: vendorResearchFailures,
      };
    }

    if (discoveryWarning && researchTargets.length > 0) {
      const attempted = researchTargets.join(', ');
      const clarification = buildVendorClarificationQuestion({
        goal,
        category: params.orchestration.intent.intent === 'compare_and_buy' ? 'compare_and_buy' : 'procurement',
      });
      return {
        status: 'needs_input',
        message: `Live discovery is unavailable and I could not extract pricing for fallback vendor target(s): ${attempted}. ${clarification}`,
        candidates: researchTargets,
        discoveryWarning,
        attemptedVendors: researchTargets,
        failedVendors: vendorResearchFailures,
      };
    }

    return {
      status: 'failed',
      message: discoveryWarning
        ? 'TinyFish could not extract usable pricing findings for fallback vendor targets.'
        : 'TinyFish could not extract usable pricing findings for this request.',
      candidates: researchTargets,
      discoveryWarning,
      failedVendors: vendorResearchFailures,
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
    message: discoveryWarning
      ? `TinyFish researched ${researchTargets.length} fallback vendor(s) and found ${findings.length} plans. Live vendor discovery is temporarily unavailable.`
      : `TinyFish researched ${researchTargets.length} ${scopeLocked ? 'scoped vendor(s)' : 'vendors'} and found ${findings.length} plans.`,
    candidates: researchTargets,
    topMatches: ranked.slice(0, 5),
    discoveryWarning,
    scopeLocked,
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
  if (!getOptionalSecret('TINYFISH_API_KEY')) {
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

    if (params.orchestration.route === 'candidate_sourcing_task') {
      const started = await startCandidateSourcingTask({
        userId: params.userId,
        taskId: params.orchestration.taskId,
      });

      return {
        status: 'queued',
        message: started.message,
        sourcingTaskId: started.taskId,
        sourcingStatus: started.status,
        started: started.started,
        platform: 'indeed',
      };
    }

    if (params.orchestration.route === 'signup_and_prepare_checkout') {
      const signup = params.orchestration.signup;
      if (signup?.mode === 'login') {
        const toolKey = signup.toolKey || signup.merchant || null;
        const actionStatus = signup.credentialState === 'action_required'
          ? 'action_required'
          : 'success';
        const toolLabel = signup.toolDisplayName || signup.merchant || 'tool';

        if (!toolKey) {
          return {
            status: 'needs_input',
            message: 'Tool login is required before I can continue.',
            task_type: 'login',
            tool: null,
            action_status: 'action_required',
            used_saved_login: false,
            notes: 'Missing tool key.',
            merchant: signup.merchant || null,
          };
        }

        const runtimeCredential = await getRuntimeCredential({
          userId: params.userId,
          toolKey,
          actionType: 'login_runtime',
        }).catch(() => null);

        if (!runtimeCredential) {
          return {
            status: 'needs_input',
            message: `Saved login for ${toolLabel} is not ready. Reconnect this tool and try again.`,
            task_type: 'login',
            tool: toolKey,
            action_status: 'action_required',
            used_saved_login: false,
            notes: 'Credential resolution failed.',
            merchant: signup.merchant || null,
          };
        }

        return {
          status: 'queued',
          message: signup.usedSavedLogin
            ? `Using saved ${toolLabel} login.`
            : `Login for ${toolLabel} is ready.`,
          task_type: 'login',
          tool: toolKey,
          action_status: actionStatus,
          used_saved_login: Boolean(signup.usedSavedLogin),
          notes: null,
          merchant: signup.merchant || null,
        };
      }

      return {
        status: 'queued',
        message: 'Signup and checkout preparation is queued in the procurement workflow.',
        task_type: 'signup',
        tool: signup?.toolKey || null,
        created_tool: false,
        login_identifier: null,
        notes: null,
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
