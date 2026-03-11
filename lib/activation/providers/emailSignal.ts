import type {
  ActivationProbeResult,
  ActivationVerificationContext,
  ActivationVerificationProvider,
} from './base.ts';

export interface EmailActivationSignal {
  id?: string;
  subject: string;
  bodySnippet?: string;
  from?: string;
  receivedAt?: string;
}

const ACTIVE_PATTERNS = [
  /subscription is active/i,
  /account is ready/i,
  /welcome to/i,
  /your plan is now active/i,
];

const FAILED_PATTERNS = [
  /payment failed/i,
  /unable to activate/i,
  /activation failed/i,
  /could not process/i,
];

const PENDING_PATTERNS = [
  /processing your order/i,
  /activation in progress/i,
  /pending verification/i,
  /we are setting up your account/i,
];

function containsPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeSignalText(signal: EmailActivationSignal): string {
  return [signal.subject, signal.bodySnippet || ''].join('\n');
}

export function createEmailSignalProvider(params: {
  getSignals: (context: ActivationVerificationContext) => Promise<EmailActivationSignal[]>;
  priority?: number;
}): ActivationVerificationProvider {
  return {
    id: 'email-signal',
    method: 'email_receipt_parsing',
    priority: params.priority ?? 20,
    supports() {
      return true;
    },
    async verify(context): Promise<ActivationProbeResult> {
      const signals = await params.getSignals(context);
      const latest = signals[0];
      const observedAt = latest?.receivedAt || context.now || new Date().toISOString();

      if (!signals.length) {
        return {
          status: 'UNKNOWN',
          evidence: {
            provider: 'email-signal',
            method: 'email_receipt_parsing',
            status: 'UNKNOWN',
            observedAt,
            summary: 'No post-purchase email signals were found.',
            raw: { signalCount: 0 },
          },
        };
      }

      for (const signal of signals) {
        const text = normalizeSignalText(signal);
        if (containsPattern(text, FAILED_PATTERNS)) {
          return {
            status: 'FAILED',
            evidence: {
              provider: 'email-signal',
              method: 'email_receipt_parsing',
              status: 'FAILED',
              observedAt: signal.receivedAt || observedAt,
              summary: 'Email content indicates activation/payment failure.',
              referenceId: signal.id || null,
              confidence: 0.8,
              raw: {
                subject: signal.subject,
                from: signal.from || null,
              },
            },
          };
        }
      }

      for (const signal of signals) {
        const text = normalizeSignalText(signal);
        if (containsPattern(text, ACTIVE_PATTERNS)) {
          return {
            status: 'ACTIVE',
            evidence: {
              provider: 'email-signal',
              method: 'email_receipt_parsing',
              status: 'ACTIVE',
              observedAt: signal.receivedAt || observedAt,
              summary: 'Email receipt confirms service activation.',
              referenceId: signal.id || null,
              confidence: 0.72,
              raw: {
                subject: signal.subject,
                from: signal.from || null,
              },
            },
          };
        }
      }

      for (const signal of signals) {
        const text = normalizeSignalText(signal);
        if (containsPattern(text, PENDING_PATTERNS)) {
          return {
            status: 'PENDING',
            evidence: {
              provider: 'email-signal',
              method: 'email_receipt_parsing',
              status: 'PENDING',
              observedAt: signal.receivedAt || observedAt,
              summary: 'Email indicates activation is still pending.',
              referenceId: signal.id || null,
              confidence: 0.65,
              raw: {
                subject: signal.subject,
                from: signal.from || null,
              },
            },
          };
        }
      }

      return {
        status: 'UNKNOWN',
        evidence: {
          provider: 'email-signal',
          method: 'email_receipt_parsing',
          status: 'UNKNOWN',
          observedAt,
          summary: 'Emails found but no activation status could be inferred.',
          raw: {
            signalCount: signals.length,
          },
        },
      };
    },
  };
}
