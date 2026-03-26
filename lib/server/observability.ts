import 'server-only';

import { installSecretRedaction, redactSecrets } from '@/security/redactSecrets';
import { captureException } from '@/lib/server/sentry';

installSecretRedaction();

export type TaskErrorCode =
  | 'VALIDATION_ERROR'
  | 'CLAUDE_REASONING_FAILURE'
  | 'OPENAI_PLANNING_FAILURE'
  | 'TINYFISH_RESEARCH_FAILURE'
  | 'POLICY_FAILURE'
  | 'DB_FAILURE'
  | 'STRIPE_FAILURE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'UNKNOWN_FAILURE';

export interface ApiErrorBody {
  ok: false;
  error: string;
  errorCode: TaskErrorCode;
  recoverable: boolean;
}

export function classifyTaskError(input: {
  message: string;
  validation?: boolean;
}): TaskErrorCode {
  if (input.validation) return 'VALIDATION_ERROR';

  const message = input.message.toLowerCase();
  if (message.includes('claude') || message.includes('anthropic')) return 'CLAUDE_REASONING_FAILURE';
  if (message.includes('openai')) return 'OPENAI_PLANNING_FAILURE';
  if (message.includes('tinyfish') || message.includes('research') || message.includes('findings')) {
    return 'TINYFISH_RESEARCH_FAILURE';
  }
  if (message.includes('policy') || message.includes('guardrail')) return 'POLICY_FAILURE';
  if (message.includes('stripe') || message.includes('checkout') || message.includes('payment intent')) {
    return 'STRIPE_FAILURE';
  }
  if (message.includes('not found')) return 'NOT_FOUND';
  if (message.includes('already') || message.includes('in progress') || message.includes('duplicate')) {
    return 'IDEMPOTENCY_CONFLICT';
  }
  if (
    message.includes('failed to update')
    || message.includes('failed to create')
    || message.includes('failed to persist agent task')
    || message.includes('failed to supersede pending task')
    || message.includes('database')
    || message.includes('could not determine data type of parameter')
    || message.includes('procurement_tasks')
    || message.includes('agent_tasks')
    || message.includes('ledger_entries')
    || message.includes('maxclientsinsessionmode')
    || message.includes('max clients reached')
    || message.includes('too many clients')
  ) {
    return 'DB_FAILURE';
  }

  return 'UNKNOWN_FAILURE';
}

export function logServerEvent(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>): void {
  const payload = JSON.stringify(redactSecrets({
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  }));

  if (level === 'error') {
    console.error(payload);
    // Forward errors to Sentry for alerting/tracking
    captureException(new Error(`[${event}] ${data.error || data.message || 'unknown'}`), {
      event,
      ...data,
    });
    return;
  }

  if (level === 'warn') {
    console.warn(payload);
    return;
  }

  console.log(payload);
}

export function apiError(
  errorCode: TaskErrorCode,
  error: string,
  recoverable: boolean,
): ApiErrorBody {
  return {
    ok: false,
    error,
    errorCode,
    recoverable,
  };
}
