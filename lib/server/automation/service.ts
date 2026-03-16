import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  recordAgentTask,
  recordApprovalDecision,
  recordWebAction,
} from '@/lib/server/ledger';
import {
  loadMoneyIntelligenceSources,
  buildMoneyIntelligenceFromSources,
} from '@/lib/server/moneyIntelligence/engine';
import {
  detectAndPersistRecurringSubscriptions,
  updateRecurringSubscriptionStatus,
} from '@/subscription_intelligence/subscriptionService';
import {
  canTransitionAutomationStatus,
  assertTransitionAutomationStatus,
} from '@/lib/server/automation/stateMachine';
import {
  cooldownUntilForActionType,
  evaluateAutomationCandidateSuppression,
} from '@/lib/server/automation/governor';
import {
  evaluateExecutionPolicy,
  requiresExplicitPermissionControls,
} from '@/lib/server/automation/policy';
import {
  getAutomationPolicyConfig,
  updateAutomationPolicyConfig,
} from '@/lib/server/automation/policyStore';
import {
  detectAutomationCandidates,
} from '@/lib/server/automation/detectors';
import {
  createAutomationActionFromCandidate,
  findActiveAutomationActionByDedup,
  findRecentSuppressionByDedup,
  getAutomationAction,
  getAutomationSummary,
  listAutomationActionEvents,
  listAutomationActions,
  recordAutomationActionEvent,
  updateAutomationActionState,
} from '@/lib/server/automation/store';
import {
  getAutomationIntegrationHook,
} from '@/lib/server/automation/integrationHooks';
import { logServerEvent } from '@/lib/server/observability';
import type {
  AutomationActionStatus,
  AutomationPolicyMode,
} from '@/lib/types';
import type {
  AutomationActionAttemptResult,
  AutomationActionRecord,
  AutomationDetectionResult,
  AutomationPolicyConfig,
  AutomationTransitionResult,
} from '@/lib/server/automation/types';

const MIN_ACTION_CONFIDENCE = 0.55;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

function targetStatusFromPolicy(mode: AutomationPolicyMode): AutomationActionStatus {
  if (mode === 'suggest_only') return 'suggested';
  if (mode === 'user_confirm_required') return 'pending_confirm';
  return 'suggested';
}

function toDecisionReason(status: AutomationActionStatus): string {
  if (status === 'pending_confirm') return 'Policy requires explicit confirmation before execution.';
  return 'Action is suggested for review in Task Center.';
}

async function syncAgentTaskFromAction(action: AutomationActionRecord): Promise<void> {
  await recordAgentTask({
    userId: action.userId,
    taskId: action.taskId,
    taskType: `automation_${action.actionType}`,
    intent: action.title,
    status: action.status,
    input: {
      automationActionId: action.id,
      policy: action.policy,
      confidence: action.confidence,
      coverageConfidence: action.coverageConfidence,
      dedupKey: action.dedupKey,
      payload: action.payload,
      explainability: action.explainability,
      requiresExplicitConfirmation: action.requiresExplicitConfirmation,
    },
    result: {
      summary: action.summary,
      status: action.status,
      updatedAt: action.updatedAt,
    },
  });
}

export async function detectAutomationActions(input: {
  userId: string;
  nowIso?: string;
}): Promise<AutomationDetectionResult> {
  const nowIso = input.nowIso || new Date().toISOString();
  const policyConfig = await getAutomationPolicyConfig(input.userId);
  const sources = await loadMoneyIntelligenceSources(input.userId);
  const money = buildMoneyIntelligenceFromSources({
    sources,
    nowIso,
  });

  const candidates = detectAutomationCandidates({
    userId: input.userId,
    nowIso,
    transactions: sources.transactions,
    recurring: sources.recurring,
    categoryRules: sources.categoryRules,
    coverage: money.coverage,
    affordability: money.affordability,
    monthlySurvivalForecast: money.monthlySurvivalForecast,
    billPredictions: money.billPredictions,
    advancedIntelligence: money.advancedIntelligence,
    currency: sources.currency,
  });

  const created: AutomationActionRecord[] = [];
  const suppressionReasons: Array<{ dedupKey: string; reason: string }> = [];

  for (const candidate of candidates) {
    const duplicate = await findActiveAutomationActionByDedup({
      userId: input.userId,
      dedupKey: candidate.dedupKey,
    });

    const cooldown = await findRecentSuppressionByDedup({
      userId: input.userId,
      dedupKey: candidate.dedupKey,
      nowIso,
    });

    const suppression = evaluateAutomationCandidateSuppression({
      confidence: candidate.confidence,
      minConfidence: MIN_ACTION_CONFIDENCE,
      hasActiveDuplicate: Boolean(duplicate),
      cooldownUntil: cooldown?.cooldownUntil || null,
      nowIso,
    });

    if (suppression !== 'ok') {
      const reason = suppression === 'cooldown' && cooldown
        ? `cooldown_until:${cooldown.cooldownUntil}`
        : suppression;
      suppressionReasons.push({ dedupKey: candidate.dedupKey, reason });
      logServerEvent('info', 'automation.detect.suppressed', {
        userId: input.userId,
        actionType: candidate.actionType,
        dedupKey: candidate.dedupKey,
        reason: suppression,
        ...(cooldown ? { cooldownUntil: cooldown.cooldownUntil } : {}),
        ...(suppression === 'low_confidence' ? { confidence: candidate.confidence } : {}),
      });
      continue;
    }

    const mode = candidate.suggestedPolicy
      || policyConfig.perActionMode[candidate.actionType]
      || policyConfig.defaultMode;
    const decision = evaluateExecutionPolicy({
      actionType: candidate.actionType,
      policyConfig: {
        ...policyConfig,
        perActionMode: {
          ...policyConfig.perActionMode,
          [candidate.actionType]: mode,
        },
      },
    });

    const taskId = randomUUID();

    const detectedAction = await createAutomationActionFromCandidate({
      userId: input.userId,
      taskId,
      candidate,
      policyMode: mode,
      requiresExplicitConfirmation: requiresExplicitPermissionControls(candidate.actionType),
      initialStatus: 'detected',
    });

    await recordAutomationActionEvent({
      userId: input.userId,
      actionId: detectedAction.id,
      eventType: 'detected',
      fromStatus: null,
      toStatus: 'detected',
      reason: 'Detected by deterministic automation detectors.',
      metadata: {
        actionType: detectedAction.actionType,
        dedupKey: detectedAction.dedupKey,
      },
    });

    const nextStatus = targetStatusFromPolicy(decision.mode);
    const promoted = await updateAutomationActionState({
      userId: input.userId,
      actionId: detectedAction.id,
      toStatus: nextStatus,
      reason: toDecisionReason(nextStatus),
    });

    await recordAutomationActionEvent({
      userId: input.userId,
      actionId: promoted.id,
      eventType: nextStatus,
      fromStatus: 'detected',
      toStatus: nextStatus,
      reason: decision.reason,
      metadata: {
        mode: decision.mode,
        requiresConfirmation: decision.requiresConfirmation,
        autopilotAllowed: decision.autopilotAllowed,
      },
    });

    await syncAgentTaskFromAction(promoted);

    logServerEvent('info', 'automation.detect.created', {
      userId: input.userId,
      actionId: promoted.id,
      actionType: promoted.actionType,
      status: promoted.status,
      policy: promoted.policy,
      confidence: promoted.confidence,
      coverageConfidence: promoted.coverageConfidence,
    });

    created.push(promoted);
  }

  return {
    detected: created.length,
    suppressed: suppressionReasons.length,
    candidates,
    actions: created,
    suppressionReasons,
  };
}

async function transitionAction(input: {
  userId: string;
  actionId: string;
  toStatus: AutomationActionStatus;
  reason: string;
  idempotencyKey?: string;
  snoozedUntil?: string;
  cooldownUntil?: string;
  metadata?: Record<string, unknown>;
}): Promise<AutomationTransitionResult> {
  const action = await getAutomationAction({ userId: input.userId, actionId: input.actionId });
  if (!action) throw new Error('Automation action not found');

  if (!canTransitionAutomationStatus({ from: action.status, to: input.toStatus })) {
    throw new Error(`Invalid transition ${action.status} -> ${input.toStatus}`);
  }

  const eventResult = await recordAutomationActionEvent({
    userId: input.userId,
    actionId: input.actionId,
    eventType: input.toStatus,
    fromStatus: action.status,
    toStatus: input.toStatus,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata,
  });

  if (eventResult.idempotentReplay) {
    const replayed = await getAutomationAction({ userId: input.userId, actionId: input.actionId });
    if (!replayed) throw new Error('Automation action disappeared during replay');
    return { action: replayed, idempotentReplay: true };
  }

  const updated = await updateAutomationActionState({
    userId: input.userId,
    actionId: input.actionId,
    toStatus: input.toStatus,
    snoozedUntil: input.snoozedUntil,
    cooldownUntil: input.cooldownUntil,
  });

  await syncAgentTaskFromAction(updated);

  logServerEvent('info', 'automation.transition', {
    userId: input.userId,
    actionId: input.actionId,
    fromStatus: action.status,
    toStatus: input.toStatus,
    idempotentReplay: false,
  });

  return {
    action: updated,
    idempotentReplay: false,
  };
}

export async function confirmAutomationAction(input: {
  userId: string;
  actionId: string;
  idempotencyKey?: string;
}): Promise<AutomationTransitionResult> {
  const action = await getAutomationAction({ userId: input.userId, actionId: input.actionId });
  if (!action) throw new Error('Automation action not found');

  if (action.status !== 'pending_confirm' && action.status !== 'suggested' && action.status !== 'detected') {
    throw new Error(`Action is not confirmable from status ${action.status}`);
  }

  await recordApprovalDecision({
    userId: input.userId,
    taskId: action.taskId,
    amount: action.amount ?? 0,
    currency: action.currency || 'usd',
    decision: 'approved',
    reason: `Automation action confirmed: ${action.actionType}`,
  });

  await recordAutomationActionEvent({
    userId: input.userId,
    actionId: action.id,
    eventType: 'confirmation_recorded',
    fromStatus: action.status,
    toStatus: action.status,
    reason: 'User approved action in Task Center.',
    idempotencyKey: input.idempotencyKey,
    metadata: {
      actionType: action.actionType,
      amount: action.amount,
      currency: action.currency,
    },
  });

  if (action.status === 'pending_confirm') {
    return { action, idempotentReplay: false };
  }

  return transitionAction({
    userId: input.userId,
    actionId: input.actionId,
    toStatus: 'pending_confirm',
    reason: 'User confirmed action in Task Center.',
    idempotencyKey: input.idempotencyKey,
  });
}

export async function dismissAutomationAction(input: {
  userId: string;
  actionId: string;
  idempotencyKey?: string;
}): Promise<AutomationTransitionResult> {
  const action = await getAutomationAction({ userId: input.userId, actionId: input.actionId });
  if (!action) throw new Error('Automation action not found');

  assertTransitionAutomationStatus({ from: action.status, to: 'dismissed' });

  return transitionAction({
    userId: input.userId,
    actionId: input.actionId,
    toStatus: 'dismissed',
    reason: 'User dismissed action from Task Center.',
    cooldownUntil: cooldownUntilForActionType({
      actionType: action.actionType,
      nowIso: new Date().toISOString(),
    }),
    idempotencyKey: input.idempotencyKey,
  });
}

export async function snoozeAutomationAction(input: {
  userId: string;
  actionId: string;
  snoozeDays?: number;
  idempotencyKey?: string;
}): Promise<AutomationTransitionResult> {
  const action = await getAutomationAction({ userId: input.userId, actionId: input.actionId });
  if (!action) throw new Error('Automation action not found');

  assertTransitionAutomationStatus({ from: action.status, to: 'snoozed' });

  const snoozeDays = Math.max(1, Math.min(input.snoozeDays ?? 3, 30));
  return transitionAction({
    userId: input.userId,
    actionId: input.actionId,
    toStatus: 'snoozed',
    reason: `Snoozed for ${snoozeDays} day(s).`,
    snoozedUntil: addDays(new Date().toISOString(), snoozeDays),
    idempotencyKey: input.idempotencyKey,
  });
}

async function runInternalAutomationExecutor(action: AutomationActionRecord): Promise<{
  supported: boolean;
  status: 'completed' | 'failed';
  message: string;
  metadata?: Record<string, unknown>;
}> {
  if (action.actionType === 'subscription_cancel') {
    const subscriptionId = typeof action.payload.subscriptionId === 'string'
      ? action.payload.subscriptionId
      : null;

    if (!subscriptionId) {
      return {
        supported: true,
        status: 'failed',
        message: 'Missing subscription identifier for cancellation.',
      };
    }

    await updateRecurringSubscriptionStatus({
      userId: action.userId,
      subscriptionId,
      status: 'inactive',
    });

    return {
      supported: true,
      status: 'completed',
      message: 'Recurring subscription lifecycle marked inactive in Calico.',
      metadata: { subscriptionId },
    };
  }

  if (action.actionType === 'recurring_review') {
    const updated = await detectAndPersistRecurringSubscriptions(action.userId);
    return {
      supported: true,
      status: 'completed',
      message: 'Recurring patterns refreshed from latest transactions.',
      metadata: { recurringCount: updated.length },
    };
  }

  if (action.actionType === 'expense_categorization') {
    return {
      supported: true,
      status: 'completed',
      message: 'Learned category rules are now prioritized for matching uncategorized transactions.',
      metadata: {
        impactedTransactionIds: Array.isArray(action.payload.impactedTransactionIds)
          ? action.payload.impactedTransactionIds
          : [],
      },
    };
  }

  if (action.actionType === 'trial_conversion_review' || action.actionType === 'bill_split') {
    return {
      supported: true,
      status: 'completed',
      message: 'Action completed as a deterministic review artifact; no provider execution required.',
      metadata: {
        reviewOnly: true,
      },
    };
  }

  return {
    supported: false,
    status: 'failed',
    message: 'No internal executor for this action type.',
  };
}

export async function attemptAutomationAction(input: {
  userId: string;
  actionId: string;
  idempotencyKey?: string;
  confirmationToken?: string;
}): Promise<AutomationActionAttemptResult> {
  const action = await getAutomationAction({ userId: input.userId, actionId: input.actionId });
  if (!action) throw new Error('Automation action not found');

  if (action.status === 'completed') {
    return {
      action,
      status: 'completed',
      message: 'Action already completed.',
      provider: 'replay',
    };
  }

  const policyConfig = await getAutomationPolicyConfig(input.userId);
  const policyDecision = evaluateExecutionPolicy({
    actionType: action.actionType,
    policyConfig,
  });

  if (policyDecision.mode === 'suggest_only') {
    await recordAutomationActionEvent({
      userId: input.userId,
      actionId: action.id,
      eventType: 'suppressed',
      fromStatus: action.status,
      toStatus: action.status,
      reason: 'Attempt blocked by suggest_only policy.',
      idempotencyKey: input.idempotencyKey,
      metadata: {
        mode: policyDecision.mode,
      },
    });

    logServerEvent('warn', 'automation.attempt.suppressed', {
      userId: input.userId,
      actionId: action.id,
      actionType: action.actionType,
      reason: 'suggest_only_policy',
    });

    return {
      action,
      status: 'blocked',
      message: 'Policy is suggest_only. Update permissions before execution.',
      provider: 'policy',
    };
  }

  if (policyDecision.requiresConfirmation && action.status !== 'pending_confirm') {
    await recordAutomationActionEvent({
      userId: input.userId,
      actionId: action.id,
      eventType: 'permission_blocked',
      fromStatus: action.status,
      toStatus: action.status,
      reason: 'Attempt blocked because confirmation is required first.',
      idempotencyKey: input.idempotencyKey,
      metadata: {
        mode: policyDecision.mode,
        requiresConfirmation: true,
      },
    });

    return {
      action,
      status: 'blocked',
      message: 'Explicit confirmation is required before attempt.',
      provider: 'policy',
    };
  }

  const attemptedTransition = await transitionAction({
    userId: input.userId,
    actionId: input.actionId,
    toStatus: 'attempted',
    reason: 'Execution attempt started.',
    idempotencyKey: input.idempotencyKey,
    metadata: {
      confirmationTokenPresent: Boolean(input.confirmationToken),
      mode: policyDecision.mode,
    },
  });

  const attempted = attemptedTransition.action;

  await recordWebAction({
    userId: input.userId,
    taskId: attempted.taskId,
    actionType: `automation_${attempted.actionType}`,
    status: 'running',
    details: {
      actionId: attempted.id,
      mode: attempted.policy,
      status: attempted.status,
    },
  });

  try {
    const internalResult = await runInternalAutomationExecutor(attempted);
    if (internalResult.supported) {
      const nextStatus = internalResult.status === 'completed' ? 'completed' : 'failed';
      const final = await updateAutomationActionState({
        userId: input.userId,
        actionId: attempted.id,
        toStatus: nextStatus,
        lastError: nextStatus === 'failed' ? internalResult.message : null,
      });

      await recordAutomationActionEvent({
        userId: input.userId,
        actionId: attempted.id,
        eventType: nextStatus,
        fromStatus: 'attempted',
        toStatus: nextStatus,
        reason: internalResult.message,
        idempotencyKey: input.idempotencyKey,
        metadata: internalResult.metadata,
      });

      await syncAgentTaskFromAction(final);

      await recordWebAction({
        userId: input.userId,
        taskId: final.taskId,
        actionType: `automation_${final.actionType}`,
        status: nextStatus === 'completed' ? 'done' : 'error',
        details: {
          actionId: final.id,
          message: internalResult.message,
          internal: true,
        },
      });

      logServerEvent(nextStatus === 'completed' ? 'info' : 'warn', 'automation.attempt.internal', {
        userId: input.userId,
        actionId: final.id,
        actionType: final.actionType,
        status: nextStatus,
      });

      return {
        action: final,
        status: nextStatus,
        message: internalResult.message,
        provider: 'internal',
      };
    }

    const hook = getAutomationIntegrationHook(attempted.actionType);
    const external = await hook.attempt({ action: attempted });

    if (!external.supported || external.status === 'failed') {
      const failed = await updateAutomationActionState({
        userId: input.userId,
        actionId: attempted.id,
        toStatus: 'failed',
        lastError: external.message,
      });

      await recordAutomationActionEvent({
        userId: input.userId,
        actionId: failed.id,
        eventType: 'failed',
        fromStatus: 'attempted',
        toStatus: 'failed',
        reason: external.message,
        idempotencyKey: input.idempotencyKey,
        metadata: {
          provider: hook.key,
          ...(external.metadata || {}),
        },
      });

      await syncAgentTaskFromAction(failed);

      await recordWebAction({
        userId: input.userId,
        taskId: failed.taskId,
        actionType: `automation_${failed.actionType}`,
        status: 'error',
        details: {
          actionId: failed.id,
          provider: hook.key,
          message: external.message,
        },
      });

      logServerEvent('warn', 'automation.attempt.failed', {
        userId: input.userId,
        actionId: failed.id,
        actionType: failed.actionType,
        provider: hook.key,
        reason: external.message,
      });

      return {
        action: failed,
        status: 'failed',
        message: external.message,
        provider: hook.key,
      };
    }

    const completed = await updateAutomationActionState({
      userId: input.userId,
      actionId: attempted.id,
      toStatus: 'completed',
      lastError: null,
    });

    await recordAutomationActionEvent({
      userId: input.userId,
      actionId: completed.id,
      eventType: 'completed',
      fromStatus: 'attempted',
      toStatus: 'completed',
      reason: external.message,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        provider: hook.key,
        ...(external.metadata || {}),
      },
    });

    await syncAgentTaskFromAction(completed);

    await recordWebAction({
      userId: input.userId,
      taskId: completed.taskId,
      actionType: `automation_${completed.actionType}`,
      status: 'done',
      details: {
        actionId: completed.id,
        provider: hook.key,
        message: external.message,
      },
    });

    logServerEvent('info', 'automation.attempt.completed', {
      userId: input.userId,
      actionId: completed.id,
      actionType: completed.actionType,
      provider: hook.key,
    });

    return {
      action: completed,
      status: 'completed',
      message: external.message,
      provider: hook.key,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown automation execution failure';

    const failed = await updateAutomationActionState({
      userId: input.userId,
      actionId: attempted.id,
      toStatus: 'failed',
      lastError: message,
    });

    await recordAutomationActionEvent({
      userId: input.userId,
      actionId: failed.id,
      eventType: 'failed',
      fromStatus: 'attempted',
      toStatus: 'failed',
      reason: message,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        crash: true,
      },
    });

    await syncAgentTaskFromAction(failed);

    await recordWebAction({
      userId: input.userId,
      taskId: failed.taskId,
      actionType: `automation_${failed.actionType}`,
      status: 'error',
      details: {
        actionId: failed.id,
        message,
      },
    });

    logServerEvent('error', 'automation.attempt.exception', {
      userId: input.userId,
      actionId: failed.id,
      actionType: failed.actionType,
      message,
    });

    return {
      action: failed,
      status: 'failed',
      message,
      provider: 'exception',
    };
  }
}

export async function reopenAutomationAction(input: {
  userId: string;
  actionId: string;
  idempotencyKey?: string;
}): Promise<AutomationTransitionResult> {
  const action = await getAutomationAction({ userId: input.userId, actionId: input.actionId });
  if (!action) throw new Error('Automation action not found');

  const target: AutomationActionStatus = action.policy === 'user_confirm_required' ? 'pending_confirm' : 'suggested';
  assertTransitionAutomationStatus({ from: action.status, to: target });

  return transitionAction({
    userId: input.userId,
    actionId: input.actionId,
    toStatus: target,
    reason: 'Action reopened for another attempt.',
    idempotencyKey: input.idempotencyKey,
  });
}

export async function getTaskCenterSnapshot(input: {
  userId: string;
  limit?: number;
}): Promise<{
  actions: AutomationActionRecord[];
  summary: Awaited<ReturnType<typeof getAutomationSummary>>;
  events: Awaited<ReturnType<typeof listAutomationActionEvents>>;
  policy: AutomationPolicyConfig;
}> {
  const [policy, actions] = await Promise.all([
    getAutomationPolicyConfig(input.userId),
    listAutomationActions({ userId: input.userId, limit: input.limit ?? 80 }),
  ]);

  const [summary, events] = await Promise.all([
    getAutomationSummary({ userId: input.userId, policyMode: policy.defaultMode }),
    listAutomationActionEvents({ userId: input.userId, limit: 80 }),
  ]);

  return {
    actions,
    summary,
    events,
    policy,
  };
}

export async function getAutomationSummaryForUser(input: {
  userId: string;
}): Promise<{
  summary: Awaited<ReturnType<typeof getAutomationSummary>>;
  policy: AutomationPolicyConfig;
}> {
  const policy = await getAutomationPolicyConfig(input.userId);
  const summary = await getAutomationSummary({
    userId: input.userId,
    policyMode: policy.defaultMode,
  });
  return { summary, policy };
}

export async function updateTaskCenterPolicy(input: {
  userId: string;
  patch: Partial<AutomationPolicyConfig>;
  idempotencyKey?: string;
}): Promise<AutomationPolicyConfig> {
  const next = await updateAutomationPolicyConfig({
    userId: input.userId,
    patch: input.patch,
  });

  logServerEvent('info', 'automation.policy.updated', {
    userId: input.userId,
    idempotencyKey: input.idempotencyKey || null,
    defaultMode: next.defaultMode,
  });

  return next;
}
