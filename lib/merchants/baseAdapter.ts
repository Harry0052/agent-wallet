import { z } from 'zod';
import type {
  ActivationEvidence,
  ActivationStatus,
  SettlementRecommendation,
} from '../activation/providers/base.ts';
import type {
  MerchantCompatibilityDecision,
  MerchantCompatibilityRequest,
} from '../schemas/merchant.ts';

export type MerchantAdapterOperation =
  | 'classifyMerchant'
  | 'prepareCheckout'
  | 'authorizePayment'
  | 'attemptProvision'
  | 'verifyActivation'
  | 'capturePayment'
  | 'voidOrRefund'
  | 'getSupportEvidence';

export interface MerchantAdapterLogEntry {
  level: 'info' | 'warn' | 'error';
  event: string;
  adapterId: string;
  merchant: string;
  operation: MerchantAdapterOperation;
  attempt: number;
  timeoutMs: number;
  elapsedMs?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface MerchantAdapterLogger {
  info(entry: MerchantAdapterLogEntry): void;
  warn(entry: MerchantAdapterLogEntry): void;
  error(entry: MerchantAdapterLogEntry): void;
}

const consoleLogger: MerchantAdapterLogger = {
  info(entry) {
    // Keep a stable structured log envelope for ingestion.
    console.info('[merchant-adapter]', entry);
  },
  warn(entry) {
    console.warn('[merchant-adapter]', entry);
  },
  error(entry) {
    console.error('[merchant-adapter]', entry);
  },
};

export const MerchantAdapterTimeoutPolicySchema = z.object({
  defaultTimeoutMs: z.number().int().positive().default(12_000),
  byOperation: z.object({
    classifyMerchant: z.number().int().positive().optional(),
    prepareCheckout: z.number().int().positive().optional(),
    authorizePayment: z.number().int().positive().optional(),
    attemptProvision: z.number().int().positive().optional(),
    verifyActivation: z.number().int().positive().optional(),
    capturePayment: z.number().int().positive().optional(),
    voidOrRefund: z.number().int().positive().optional(),
    getSupportEvidence: z.number().int().positive().optional(),
  }).default({}),
});

export type MerchantAdapterTimeoutPolicy = z.infer<typeof MerchantAdapterTimeoutPolicySchema>;

export const MerchantAdapterRetryPolicySchema = z.object({
  maxAttempts: z.number().int().positive().default(2),
  baseDelayMs: z.number().int().nonnegative().default(250),
  maxDelayMs: z.number().int().positive().default(3_000),
  jitterRatio: z.number().min(0).max(1).default(0.15),
  retryableErrorPatterns: z.array(z.string().min(1)).default([
    'timeout',
    'timed out',
    'network',
    'econnreset',
    '502',
    '503',
    '504',
    '429',
  ]),
});

export type MerchantAdapterRetryPolicy = z.infer<typeof MerchantAdapterRetryPolicySchema>;

export const MerchantAdapterConfigSchema = z.object({
  adapterId: z.string().min(3),
  merchant: z.string().min(1),
  timeoutPolicy: MerchantAdapterTimeoutPolicySchema.default({
    defaultTimeoutMs: 12_000,
    byOperation: {},
  }),
  retryPolicy: MerchantAdapterRetryPolicySchema.default({
    maxAttempts: 2,
    baseDelayMs: 250,
    maxDelayMs: 3_000,
    jitterRatio: 0.15,
    retryableErrorPatterns: ['timeout', 'timed out', 'network', 'econnreset', '502', '503', '504', '429'],
  }),
  metadata: z.record(z.unknown()).default({}),
});

export type MerchantAdapterConfig = z.infer<typeof MerchantAdapterConfigSchema>;

export interface MerchantOperationContext {
  userId: string;
  taskId?: string | null;
  paymentId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ClassifyMerchantInput {
  request: MerchantCompatibilityRequest;
  context?: MerchantOperationContext;
}

export interface ClassifyMerchantResult {
  supported: boolean;
  decision: MerchantCompatibilityDecision;
  reason?: string;
}

export interface PrepareCheckoutInput {
  merchant: string;
  planId?: string;
  amount: number;
  currency: string;
  context: MerchantOperationContext;
}

export interface PrepareCheckoutResult {
  status: 'ready' | 'blocked';
  checkoutUrl?: string;
  checkoutReference?: string;
  blockedReason?: string;
  requiresUserInteraction: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface AuthorizePaymentInput {
  merchant: string;
  amount: number;
  currency: string;
  context: MerchantOperationContext;
}

export interface AuthorizePaymentResult {
  status: 'authorized' | 'pending' | 'failed';
  authorizationReference?: string;
  message?: string;
  metadata?: Record<string, unknown> | null;
}

export interface AttemptProvisionInput {
  merchant: string;
  planId?: string;
  context: MerchantOperationContext;
}

export interface AttemptProvisionResult {
  status: 'provisioned' | 'pending' | 'failed';
  provisionReference?: string;
  message?: string;
  metadata?: Record<string, unknown> | null;
}

export interface VerifyActivationInput {
  merchant: string;
  context: MerchantOperationContext & {
    authorizedAt: string;
  };
}

export interface VerifyActivationResult {
  activationStatus: ActivationStatus;
  evidence: ActivationEvidence[];
  verifiedAt: string | null;
  settlementRecommendation: SettlementRecommendation;
  message?: string;
}

export interface CapturePaymentInput {
  merchant: string;
  amount: number;
  currency: string;
  context: MerchantOperationContext;
}

export interface CapturePaymentResult {
  status: 'captured' | 'pending' | 'failed';
  captureReference?: string;
  message?: string;
  metadata?: Record<string, unknown> | null;
}

export interface VoidOrRefundInput {
  merchant: string;
  amount: number;
  currency: string;
  reason: string;
  context: MerchantOperationContext;
}

export interface VoidOrRefundResult {
  status: 'voided' | 'refunded' | 'pending' | 'failed';
  referenceId?: string;
  message?: string;
  metadata?: Record<string, unknown> | null;
}

export interface SupportEvidenceInput {
  merchant: string;
  context: MerchantOperationContext;
}

export interface SupportEvidenceResult {
  evidence: {
    merchant: string;
    adapterId: string;
    transactionReferences: string[];
    timeline: Array<{
      timestamp: string;
      stage: MerchantAdapterOperation;
      summary: string;
      details?: Record<string, unknown> | null;
    }>;
    notes: string[];
    raw?: Record<string, unknown> | null;
  };
}

export class MerchantAdapterTimeoutError extends Error {
  operation: MerchantAdapterOperation;

  timeoutMs: number;

  constructor(operation: MerchantAdapterOperation, timeoutMs: number) {
    super(`Operation ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'MerchantAdapterTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export class MerchantAdapterUnsupportedError extends Error {
  operation: MerchantAdapterOperation;

  constructor(operation: MerchantAdapterOperation, message: string) {
    super(message);
    this.name = 'MerchantAdapterUnsupportedError';
    this.operation = operation;
  }
}

export abstract class MerchantAdapter<TConfig extends MerchantAdapterConfig = MerchantAdapterConfig> {
  readonly config: TConfig;

  protected readonly logger: MerchantAdapterLogger;

  protected constructor(config: TConfig, deps?: { logger?: MerchantAdapterLogger }) {
    this.config = config;
    this.logger = deps?.logger || consoleLogger;
  }

  async classifyMerchant(input: ClassifyMerchantInput): Promise<ClassifyMerchantResult> {
    return this.executeWithPolicy('classifyMerchant', 1, () => this.doClassifyMerchant(input));
  }

  async prepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    return this.executeWithPolicy('prepareCheckout', 1, () => this.doPrepareCheckout(input));
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentResult> {
    return this.executeWithPolicy('authorizePayment', 1, () => this.doAuthorizePayment(input));
  }

  async attemptProvision(input: AttemptProvisionInput): Promise<AttemptProvisionResult> {
    return this.executeWithPolicy('attemptProvision', 1, () => this.doAttemptProvision(input));
  }

  async verifyActivation(input: VerifyActivationInput): Promise<VerifyActivationResult> {
    return this.executeWithPolicy('verifyActivation', 1, () => this.doVerifyActivation(input));
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentResult> {
    return this.executeWithPolicy('capturePayment', 1, () => this.doCapturePayment(input));
  }

  async voidOrRefund(input: VoidOrRefundInput): Promise<VoidOrRefundResult> {
    return this.executeWithPolicy('voidOrRefund', 1, () => this.doVoidOrRefund(input));
  }

  async getSupportEvidence(input: SupportEvidenceInput): Promise<SupportEvidenceResult> {
    return this.executeWithPolicy('getSupportEvidence', 1, () => this.doGetSupportEvidence(input));
  }

  protected abstract doClassifyMerchant(input: ClassifyMerchantInput): Promise<ClassifyMerchantResult>;

  protected abstract doPrepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult>;

  protected abstract doAuthorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentResult>;

  protected abstract doAttemptProvision(input: AttemptProvisionInput): Promise<AttemptProvisionResult>;

  protected abstract doVerifyActivation(input: VerifyActivationInput): Promise<VerifyActivationResult>;

  protected abstract doCapturePayment(input: CapturePaymentInput): Promise<CapturePaymentResult>;

  protected abstract doVoidOrRefund(input: VoidOrRefundInput): Promise<VoidOrRefundResult>;

  protected abstract doGetSupportEvidence(input: SupportEvidenceInput): Promise<SupportEvidenceResult>;

  protected nowIso(): string {
    return new Date().toISOString();
  }

  protected async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  protected isRetryableError(error: unknown): boolean {
    if (error instanceof MerchantAdapterUnsupportedError) return false;
    if (error instanceof MerchantAdapterTimeoutError) return true;

    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return this.config.retryPolicy.retryableErrorPatterns.some((pattern) => message.includes(pattern.toLowerCase()));
  }

  protected resolveTimeoutMs(operation: MerchantAdapterOperation): number {
    return this.config.timeoutPolicy.byOperation[operation]
      ?? this.config.timeoutPolicy.defaultTimeoutMs;
  }

  protected computeRetryDelayMs(attempt: number): number {
    const base = this.config.retryPolicy.baseDelayMs;
    const exp = Math.max(0, attempt - 1);
    const withoutJitter = Math.min(this.config.retryPolicy.maxDelayMs, base * (2 ** exp));
    const jitterRange = withoutJitter * this.config.retryPolicy.jitterRatio;
    const jitter = jitterRange === 0 ? 0 : (Math.random() * 2 - 1) * jitterRange;
    return Math.max(0, Math.round(withoutJitter + jitter));
  }

  protected async executeWithPolicy<T>(
    operation: MerchantAdapterOperation,
    attempt: number,
    task: () => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.resolveTimeoutMs(operation);

    this.logger.info({
      level: 'info',
      event: 'merchant.adapter.operation.start',
      adapterId: this.config.adapterId,
      merchant: this.config.merchant,
      operation,
      attempt,
      timeoutMs,
    });

    const startedAt = Date.now();

    try {
      const result = await this.withTimeout(operation, timeoutMs, task);
      this.logger.info({
        level: 'info',
        event: 'merchant.adapter.operation.success',
        adapterId: this.config.adapterId,
        merchant: this.config.merchant,
        operation,
        attempt,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = attempt < this.config.retryPolicy.maxAttempts && this.isRetryableError(error);

      if (retryable) {
        const nextDelayMs = this.computeRetryDelayMs(attempt);
        this.logger.warn({
          level: 'warn',
          event: 'merchant.adapter.operation.retry',
          adapterId: this.config.adapterId,
          merchant: this.config.merchant,
          operation,
          attempt,
          timeoutMs,
          elapsedMs: Date.now() - startedAt,
          message,
          metadata: {
            nextDelayMs,
            maxAttempts: this.config.retryPolicy.maxAttempts,
          },
        });

        await this.sleep(nextDelayMs);
        return this.executeWithPolicy(operation, attempt + 1, task);
      }

      this.logger.error({
        level: 'error',
        event: 'merchant.adapter.operation.failed',
        adapterId: this.config.adapterId,
        merchant: this.config.merchant,
        operation,
        attempt,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        message,
      });
      throw error;
    }
  }

  private async withTimeout<T>(
    operation: MerchantAdapterOperation,
    timeoutMs: number,
    task: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new MerchantAdapterTimeoutError(operation, timeoutMs));
      }, timeoutMs);

      task()
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
