import type {
  AccountStateCheckAdapter,
  ActivationEvidence,
  ActivationStatus,
  ActivationVerificationContext,
  ActivationVerificationProvider,
  NextAction,
  SettlementRecommendation,
} from './providers/base.ts';

export interface ActivationEnginePolicy {
  activationTimeoutMs: number;
  safeModeOnTimeout: boolean;
}

export interface ActivationEngineInput extends ActivationVerificationContext {}

export interface ActivationEngineResult {
  activationStatus: ActivationStatus;
  evidence: ActivationEvidence[];
  verifiedAt: string | null;
  nextAction: NextAction;
  settlementRecommendation: SettlementRecommendation;
}

const DEFAULT_POLICY: ActivationEnginePolicy = {
  activationTimeoutMs: 15 * 60 * 1000,
  safeModeOnTimeout: true,
};

function toMs(iso: string): number {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return parsed;
}

function safeNow(input?: string): string {
  return input || new Date().toISOString();
}

function pickVerifiedAt(evidence: ActivationEvidence[], status: ActivationStatus): string | null {
  const candidates = evidence
    .filter((item) => item.status === status)
    .map((item) => item.observedAt)
    .filter((value) => Boolean(value))
    .sort();
  return candidates[0] || null;
}

function evaluateWithoutTimeout(evidence: ActivationEvidence[]): {
  activationStatus: ActivationStatus;
  nextAction: NextAction;
  settlementRecommendation: SettlementRecommendation;
} {
  if (evidence.some((item) => item.status === 'FAILED')) {
    return {
      activationStatus: 'FAILED',
      nextAction: 'VOID_OR_REFUND',
      settlementRecommendation: 'VOID_OR_REFUND',
    };
  }

  if (evidence.some((item) => item.status === 'ACTIVE')) {
    return {
      activationStatus: 'ACTIVE',
      nextAction: 'CAPTURE_FUNDS',
      settlementRecommendation: 'CAPTURE_SETTLEMENT',
    };
  }

  if (evidence.some((item) => item.status === 'PENDING')) {
    return {
      activationStatus: 'PENDING',
      nextAction: 'WAIT_FOR_SIGNAL',
      settlementRecommendation: 'HOLD_SETTLEMENT',
    };
  }

  return {
    activationStatus: 'UNKNOWN',
    nextAction: 'REQUEST_HUMAN_REVIEW',
    settlementRecommendation: 'MANUAL_REVIEW',
  };
}

export function createActivationVerificationEngine(params: {
  providers: ActivationVerificationProvider[];
  accountStateChecker?: AccountStateCheckAdapter;
  policy?: Partial<ActivationEnginePolicy>;
}) {
  const policy: ActivationEnginePolicy = {
    ...DEFAULT_POLICY,
    ...(params.policy || {}),
  };

  const providers = [...params.providers].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  async function runProvider(
    provider: ActivationVerificationProvider,
    context: ActivationEngineInput,
  ): Promise<ActivationEvidence | null> {
    const supported = await provider.supports(context);
    if (!supported) return null;

    try {
      const result = await provider.verify(context);
      return result.evidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        provider: provider.id,
        method: provider.method,
        status: 'UNKNOWN',
        observedAt: safeNow(context.now),
        summary: `Provider check failed: ${message}`,
        raw: { error: message },
      };
    }
  }

  async function runAccountStateCheck(
    checker: AccountStateCheckAdapter,
    context: ActivationEngineInput,
  ): Promise<ActivationEvidence> {
    try {
      const result = await checker.check(context);
      return {
        provider: checker.id,
        method: 'post_purchase_account_state_check',
        status: result.status,
        observedAt: result.observedAt || safeNow(context.now),
        summary: result.summary,
        referenceId: result.referenceId || null,
        confidence: result.confidence ?? 0.88,
        raw: result.raw || null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        provider: checker.id,
        method: 'post_purchase_account_state_check',
        status: 'UNKNOWN',
        observedAt: safeNow(context.now),
        summary: `Account-state check failed: ${message}`,
        raw: { error: message },
      };
    }
  }

  async function verify(input: ActivationEngineInput): Promise<ActivationEngineResult> {
    const now = safeNow(input.now);
    const elapsedMs = toMs(now) - toMs(input.authorizedAt);
    const timedOut = elapsedMs >= policy.activationTimeoutMs;

    const evidence: ActivationEvidence[] = [];
    for (const provider of providers) {
      const providerEvidence = await runProvider(provider, { ...input, now });
      if (providerEvidence) evidence.push(providerEvidence);
    }

    if (params.accountStateChecker) {
      evidence.push(await runAccountStateCheck(params.accountStateChecker, { ...input, now }));
    }

    const base = evaluateWithoutTimeout(evidence);

    if (base.activationStatus === 'ACTIVE') {
      return {
        activationStatus: 'ACTIVE',
        evidence,
        verifiedAt: pickVerifiedAt(evidence, 'ACTIVE'),
        nextAction: base.nextAction,
        settlementRecommendation: base.settlementRecommendation,
      };
    }

    if (timedOut) {
      evidence.push({
        provider: 'activation-timeout-policy',
        method: 'timeout_classification',
        status: 'FAILED',
        observedAt: now,
        summary: `Activation not verified within ${policy.activationTimeoutMs}ms timeout window.`,
        confidence: 1,
        raw: {
          elapsedMs,
          timeoutMs: policy.activationTimeoutMs,
          safeModeOnTimeout: policy.safeModeOnTimeout,
        },
      });

      if (policy.safeModeOnTimeout) {
        return {
          activationStatus: 'FAILED',
          evidence,
          verifiedAt: now,
          nextAction: 'DO_NOT_MARK_TASK_COMPLETE',
          settlementRecommendation: 'VOID_OR_REFUND',
        };
      }

      return {
        activationStatus: 'UNKNOWN',
        evidence,
        verifiedAt: null,
        nextAction: 'DO_NOT_MARK_TASK_COMPLETE',
        settlementRecommendation: 'HOLD_SETTLEMENT',
      };
    }

    return {
      activationStatus: base.activationStatus,
      evidence,
      verifiedAt: base.activationStatus === 'FAILED'
        ? pickVerifiedAt(evidence, 'FAILED')
        : null,
      nextAction: base.nextAction,
      settlementRecommendation: base.settlementRecommendation,
    };
  }

  return {
    verify,
    policy,
  };
}
