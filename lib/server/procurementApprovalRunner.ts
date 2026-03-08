import { randomUUID } from 'node:crypto';
import type { ProcurementRecommendationRecord, ProcurementTaskRecord } from '@/lib/types';
import {
  getUserAutofillProfile,
  getWallet,
  recordAgentTask,
  recordLedgerEntry,
  recordWebAction,
  updateLedgerEntryStatus,
} from '@/lib/server/ledger';
import { routePurchaseExecutionWorkflow } from '@/lib/server/paymentWorkflowRouter';
import { labelForProfileField, mapProfileToFormFill, type ProfileFieldKey } from '@/lib/server/profileFormMapper';
import { getProcurementTask, updateProcurementTask } from '@/lib/server/procurement';
import { parseProcurementRecommendation, recommendationAmount } from '@/lib/server/procurementRecommendation';
import { runTinyFishPurchaseExecution } from '@/lib/server/tinyfishPurchaseExecute';
import { runTinyFishPurchasePreparation } from '@/lib/server/tinyfishPurchasePrep';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Unknown purchase preparation error';
}

async function appendLog(params: {
  userId: string;
  taskId: string;
  actionType: string;
  status: 'running' | 'done' | 'error';
  message: string;
  url?: string;
  phase?: string;
  event?: string;
  code?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await recordWebAction({
    userId: params.userId,
    taskId: params.taskId,
    actionType: params.actionType,
    status: params.status,
    url: params.url,
    details: {
      id: randomUUID(),
      phase: params.phase,
      event: params.event,
      code: params.code,
      message: params.message,
      ...params.details,
    },
  });
}

async function persistTask(task: ProcurementTaskRecord, params: {
  status: ProcurementTaskRecord['status'];
  recommendation: ProcurementRecommendationRecord;
  error?: string;
}): Promise<ProcurementTaskRecord> {
  return updateProcurementTask({
    taskId: task.id,
    userId: task.userId,
    status: params.status,
    goal: task.goal,
    budgetLimit: task.budgetLimit,
    category: task.category,
    targetVendors: task.targetVendors,
    comparisonCriteria: task.comparisonCriteria,
    mustHaveFeatures: task.mustHaveFeatures,
    findings: task.findings,
    recommendation: params.recommendation as unknown as Record<string, unknown>,
    planningOutput: task.planningOutput,
    error: params.error,
  });
}

export async function runProcurementPurchasePreparation(params: {
  userId: string;
  taskId: string;
  resumeCredentialSecret?: string;
}): Promise<void> {
  const task = await getProcurementTask({ taskId: params.taskId, userId: params.userId });
  if (!task) {
    throw new Error(`Procurement task not found: ${params.taskId}`);
  }

  const recommendation = parseProcurementRecommendation(task.recommendation);
  if (!recommendation || !recommendation.winner) {
    throw new Error('No recommendation winner is available for purchase preparation');
  }

  if (!recommendation.policy?.allowed) {
    throw new Error('Purchase preparation is blocked because policy checks did not pass');
  }

  const winner = recommendation.winner;
  const amountInfo = recommendationAmount(recommendation);
  const profile = await getUserAutofillProfile(task.userId);
  const mappedProfile = mapProfileToFormFill({
    profile,
    required: ['full_name', 'email'],
  });
  const nextRecommendation: ProcurementRecommendationRecord = {
    ...recommendation,
    purchasePrep: {
      status: 'running',
      proofUrls: recommendation.purchasePrep?.proofUrls || [],
      pendingLedgerEntry: recommendation.purchasePrep?.pendingLedgerEntry,
    },
  };

  await persistTask(task, {
    status: 'purchase_preparing',
    recommendation: nextRecommendation,
  });

  await appendLog({
    userId: task.userId,
    taskId: task.id,
    actionType: 'checkout',
    status: 'running',
    phase: 'purchase_prep',
    event: 'purchase_prep_started',
    code: 'PURCHASE_PREP_STARTED',
    message: `navigating ${winner.vendorName} signup/checkout flow`,
    url: winner.pricingPageUrl,
  });

  await appendLog({
    userId: task.userId,
    taskId: task.id,
    actionType: 'form-fill',
    status: 'running',
    phase: 'purchase_prep',
    event: 'purchase_form_fill_started',
    code: 'PURCHASE_FORM_FILL_STARTED',
    message: `filling plan and account form fields for ${winner.planName}`,
  });

  try {
    const prep = await runTinyFishPurchasePreparation({
      taskId: task.id,
      vendorName: winner.vendorName,
      planName: winner.planName,
      pricingPageUrl: winner.pricingPageUrl,
      amount: amountInfo.amount,
      amountBasis: amountInfo.basis,
      formFillProfile: mappedProfile.fields,
      credentialSecret: params.resumeCredentialSecret,
    });

    for (const step of prep.steps) {
      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: step.type,
        status: step.status,
        phase: 'purchase_prep',
        event: 'tinyfish_step',
        code: 'TINYFISH_STEP',
        message: step.description,
        url: step.url,
      });
    }

    if (prep.blocker) {
      const canResume = (
        prep.blocker.code === 'missing_profile_fields'
        || prep.blocker.code === 'missing_credentials'
      );
      const missingProfileFields = prep.blocker.code === 'missing_profile_fields'
        ? prep.blocker.missingFields
            .filter((field): field is ProfileFieldKey => Boolean(field))
            .map((field) => labelForProfileField(field))
        : [];

      const clarificationMessage = prep.blocker.code === 'missing_profile_fields'
        ? `I need ${missingProfileFields[0] || 'more profile details'} to continue ${winner.vendorName} sign-up.`
        : prep.blocker.code === 'missing_credentials'
          ? `I reached ${winner.vendorName} sign-in. I need your credential to continue securely.`
          : prep.blocker.message;

      const blockedRecommendation: ProcurementRecommendationRecord = {
        ...recommendation,
        purchasePrep: {
          status: 'failed',
          proofUrls: prep.proofUrls,
          pendingLedgerEntry: recommendation.purchasePrep?.pendingLedgerEntry,
          blocker: {
            code: prep.blocker.code,
            message: prep.blocker.message,
            missingFields: prep.blocker.missingFields,
            sensitive: prep.blocker.sensitive,
            canResume,
          },
          error: prep.blocker.message,
        },
      };

      await persistTask(task, {
        status: canResume ? 'needs_clarification' : 'failed',
        recommendation: blockedRecommendation,
        error: canResume
          ? `[CLARIFICATION_REQUIRED] ${prep.blocker.message}`
          : `[TINYFISH_RESEARCH_FAILURE] ${prep.blocker.message}`,
      });

      if (canResume) {
        await recordAgentTask({
          userId: task.userId,
          taskId: task.id,
          taskType: 'signup_and_prepare_checkout',
          intent: `continue ${winner.vendorName} signup`,
          status: 'awaiting_clarification',
          input: {
            intent: 'signup_and_prepare_checkout',
            merchant: winner.vendorName,
            required_profile_fields: prep.blocker.code === 'missing_profile_fields'
              ? prep.blocker.missingFields
              : ['email'],
            procurement_task_id: task.id,
            resume_action: 'purchase_prep',
            missing_security_credential: prep.blocker.code === 'missing_credentials',
          },
          result: {
            question: clarificationMessage,
            missingFields: prep.blocker.missingFields,
            blockerCode: prep.blocker.code,
          },
        });
      }

      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'checkout',
        status: canResume ? 'running' : 'error',
        phase: 'purchase_prep',
        event: 'purchase_prep_blocked',
        code: 'PURCHASE_PREP_BLOCKED',
        message: clarificationMessage,
        url: prep.checkoutUrl || winner.pricingPageUrl,
        details: {
          blocker: prep.blocker,
          canResume,
        },
      });

      return;
    }

    let pendingLedgerEntry = recommendation.purchasePrep?.pendingLedgerEntry;
    if (!pendingLedgerEntry && amountInfo.amount !== null) {
      const ledger = await recordLedgerEntry({
        userId: task.userId,
        type: 'procurement_commitment',
        amount: amountInfo.amount,
        currency: 'usd',
        direction: 'debit',
        status: 'pending',
        description: `Purchase prepared: ${winner.vendorName} ${winner.planName} (${amountInfo.basis})`,
        merchant: winner.vendorName,
        sourceUrl: prep.checkoutUrl || winner.pricingPageUrl,
        metadata: {
          procurement_task_id: task.id,
          taskTitle: `${task.goal.slice(0, 120)}`,
          plan_name: winner.planName,
          amount_basis: amountInfo.basis,
        },
      });

      pendingLedgerEntry = {
        entryId: ledger.id,
        type: 'procurement_commitment',
        status: 'pending',
        amount: ledger.amount,
        currency: ledger.currency,
        description: ledger.description,
      };
    }

    const checkoutUrl = prep.checkoutUrl || winner.pricingPageUrl;
    const wallet = await getWallet(task.userId);
    const paymentDecision = routePurchaseExecutionWorkflow({
      wallet,
      amount: amountInfo.amount,
    });

    if (paymentDecision.route === 'fund_wallet') {
      const blockedRecommendation: ProcurementRecommendationRecord = {
        ...recommendation,
        purchasePrep: {
          status: 'prepared',
          preparedAt: new Date().toISOString(),
          checkoutUrl,
          proofUrls: prep.proofUrls,
          pendingLedgerEntry,
          blocker: {
            code: 'insufficient_wallet_balance',
            message: `Wallet balance is short by $${(paymentDecision.shortfall || 0).toFixed(2)} for payment execution.`,
            missingFields: ['wallet_topup_approval'],
            sensitive: false,
            canResume: true,
          },
        },
      };

      await persistTask(task, {
        status: 'needs_clarification',
        recommendation: blockedRecommendation,
        error: `[INSUFFICIENT_BALANCE] Wallet top-up approval required before execution.`,
      });

      await recordAgentTask({
        userId: task.userId,
        taskId: task.id,
        taskType: 'fund_wallet',
        intent: 'fund wallet for purchase execution',
        status: 'awaiting_clarification',
        input: {
          intent: 'fund_wallet',
          amount: paymentDecision.shortfall,
          procurement_task_id: task.id,
          resume_action: 'execute_purchase',
        },
        result: {
          question: `Payment is ready, but wallet balance is short by $${(paymentDecision.shortfall || 0).toFixed(2)}. Approve top-up to continue?`,
          missingFields: ['wallet_topup_approval'],
        },
      });

      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'guardrail',
        status: 'running',
        phase: 'purchase_prep',
        event: 'wallet_balance_insufficient',
        code: 'WALLET_BALANCE_INSUFFICIENT',
        message: `wallet-balance-first check failed; shortfall ${(paymentDecision.shortfall || 0).toFixed(2)} requires top-up approval`,
        url: checkoutUrl,
      });

      return;
    }

    await appendLog({
      userId: task.userId,
      taskId: task.id,
      actionType: 'checkout',
      status: 'running',
      phase: 'purchase_prep',
      event: 'payment_execution_started',
      code: 'PAYMENT_EXECUTION_STARTED',
      message: 'wallet-balance-first check passed; executing real provider payment path',
      url: checkoutUrl,
    });

    const execution = await runTinyFishPurchaseExecution({
      taskId: task.id,
      vendorName: winner.vendorName,
      checkoutUrl,
      amount: amountInfo.amount,
      currency: 'usd',
    });

    for (const step of execution.steps) {
      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: step.type,
        status: step.status,
        phase: 'purchase_prep',
        event: 'tinyfish_step',
        code: 'TINYFISH_STEP',
        message: step.description,
        url: step.url,
      });
    }

    if (!execution.success) {
      if (pendingLedgerEntry) {
        await updateLedgerEntryStatus({
          userId: task.userId,
          entryId: pendingLedgerEntry.entryId,
          status: 'failed',
          descriptionSuffix: 'provider payment was not confirmed',
        });
      }

      throw new Error('Provider payment execution was not confirmed by TinyFish/provider path');
    }

    if (pendingLedgerEntry) {
      await updateLedgerEntryStatus({
        userId: task.userId,
        entryId: pendingLedgerEntry.entryId,
        status: 'succeeded',
        stripeObjectId: execution.providerReferenceId || undefined,
        descriptionSuffix: 'provider payment confirmed',
        metadataPatch: {
          payment_confirmed: 'true',
          provider_reference_id: execution.providerReferenceId || '',
        },
      });
    }

    const updatedRecommendation: ProcurementRecommendationRecord = {
      ...recommendation,
      purchasePrep: {
        status: 'prepared',
        preparedAt: new Date().toISOString(),
        checkoutUrl,
        proofUrls: prep.proofUrls,
        pendingLedgerEntry,
      },
    };

    await persistTask(task, {
      status: 'purchase_prepared',
      recommendation: updatedRecommendation,
    });

    await appendLog({
      userId: task.userId,
      taskId: task.id,
      actionType: 'checkout',
      status: 'done',
      phase: 'purchase_prep',
      event: 'payment_execution_completed',
      code: 'PAYMENT_EXECUTION_COMPLETED',
      message: execution.providerReferenceId
        ? `provider payment confirmed (ref: ${execution.providerReferenceId})`
        : 'provider payment confirmed',
      url: checkoutUrl,
    });

    if (prep.proofUrls.length > 0) {
      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'extract',
        status: 'done',
        phase: 'purchase_prep',
        event: 'purchase_proof_captured',
        code: 'PURCHASE_PROOF_CAPTURED',
        message: `captured ${prep.proofUrls.length} proof reference(s) from TinyFish`,
        details: { proofUrls: prep.proofUrls },
      });
    }
  } catch (error) {
    const message = errorMessage(error);
    const failedRecommendation: ProcurementRecommendationRecord = {
      ...recommendation,
      purchasePrep: {
        status: 'failed',
        proofUrls: recommendation.purchasePrep?.proofUrls || [],
        pendingLedgerEntry: recommendation.purchasePrep?.pendingLedgerEntry,
        error: message,
      },
    };

    await persistTask(task, {
      status: 'failed',
      recommendation: failedRecommendation,
      error: `[TINYFISH_RESEARCH_FAILURE] ${message}`,
    });

    await appendLog({
      userId: task.userId,
      taskId: task.id,
      actionType: 'checkout',
      status: 'error',
      phase: 'purchase_prep',
      event: 'purchase_prep_failed',
      code: 'PURCHASE_PREP_FAILED',
      message: `purchase preparation failed: ${message}`,
    });
  }
}
