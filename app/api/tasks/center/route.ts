import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import {
  attemptAutomationAction,
  confirmAutomationAction,
  detectAutomationActions,
  dismissAutomationAction,
  getTaskCenterSnapshot,
  reopenAutomationAction,
  snoozeAutomationAction,
  updateTaskCenterPolicy,
} from '@/lib/server/automation/service';
import type { AutomationActionType, AutomationPolicyMode } from '@/lib/types';
import { isAuthError } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const policyModeSchema = z.enum([
  'suggest_only',
  'user_confirm_required',
  'autopilot_allowed',
]);

const perActionModeSchema = z.object({
  subscription_cancel: policyModeSchema.optional(),
  subscription_negotiate: policyModeSchema.optional(),
  bill_pay: policyModeSchema.optional(),
  savings_transfer: policyModeSchema.optional(),
  debt_optimize: policyModeSchema.optional(),
  expense_categorization: policyModeSchema.optional(),
  refund_budget: policyModeSchema.optional(),
  recurring_review: policyModeSchema.optional(),
  trial_conversion_review: policyModeSchema.optional(),
  bill_split: policyModeSchema.optional(),
});

const perActionBooleanSchema = z.object({
  subscription_cancel: z.boolean().optional(),
  subscription_negotiate: z.boolean().optional(),
  bill_pay: z.boolean().optional(),
  savings_transfer: z.boolean().optional(),
  debt_optimize: z.boolean().optional(),
  expense_categorization: z.boolean().optional(),
  refund_budget: z.boolean().optional(),
  recurring_review: z.boolean().optional(),
  trial_conversion_review: z.boolean().optional(),
  bill_split: z.boolean().optional(),
});

const commandSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('detect'),
  }),
  z.object({
    command: z.literal('attempt'),
    actionId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
    confirmationToken: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    command: z.literal('confirm'),
    actionId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    command: z.literal('dismiss'),
    actionId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    command: z.literal('snooze'),
    actionId: z.string().trim().min(1),
    snoozeDays: z.number().int().min(1).max(30).optional(),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    command: z.literal('reopen'),
    actionId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    command: z.literal('policy_update'),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
    patch: z.object({
      defaultMode: policyModeSchema.optional(),
      perActionMode: perActionModeSchema.optional(),
      autopilotEnabledActions: perActionBooleanSchema.optional(),
      explicitConfirmEnabledActions: perActionBooleanSchema.optional(),
    }),
  }),
]);

function serializePolicyPatch(input: {
  defaultMode?: AutomationPolicyMode;
  perActionMode?: Partial<Record<AutomationActionType, AutomationPolicyMode>>;
  autopilotEnabledActions?: Partial<Record<AutomationActionType, boolean>>;
  explicitConfirmEnabledActions?: Partial<Record<AutomationActionType, boolean>>;
}) {
  return {
    ...(input.defaultMode ? { defaultMode: input.defaultMode } : {}),
    ...(input.perActionMode ? { perActionMode: input.perActionMode } : {}),
    ...(input.autopilotEnabledActions ? { autopilotEnabledActions: input.autopilotEnabledActions } : {}),
    ...(input.explicitConfirmEnabledActions ? { explicitConfirmEnabledActions: input.explicitConfirmEnabledActions } : {}),
  };
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'task_center' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const snapshot = await getTaskCenterSnapshot({
      userId: auth.auth.walletUserId,
      limit: 100,
    });

    return NextResponse.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), {
        status: error.status,
      });
    }

    const message = error instanceof Error ? error.message : 'Failed to load task center.';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'tasks.center.get.failed', {
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'task_center_command' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const body = commandSchema.parse(await req.json());

    if (body.command === 'detect') {
      const result = await detectAutomationActions({ userId });
      return NextResponse.json({ ok: true, result });
    }

    if (body.command === 'attempt') {
      const result = await attemptAutomationAction({
        userId,
        actionId: body.actionId,
        idempotencyKey: body.idempotencyKey,
        confirmationToken: body.confirmationToken,
      });
      return NextResponse.json({ ok: true, result });
    }

    if (body.command === 'confirm') {
      const result = await confirmAutomationAction({
        userId,
        actionId: body.actionId,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, result });
    }

    if (body.command === 'dismiss') {
      const result = await dismissAutomationAction({
        userId,
        actionId: body.actionId,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, result });
    }

    if (body.command === 'snooze') {
      const result = await snoozeAutomationAction({
        userId,
        actionId: body.actionId,
        snoozeDays: body.snoozeDays,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, result });
    }

    if (body.command === 'reopen') {
      const result = await reopenAutomationAction({
        userId,
        actionId: body.actionId,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, result });
    }

    if (body.command === 'policy_update') {
      const policy = await updateTaskCenterPolicy({
        userId,
        patch: serializePolicyPatch(body.patch),
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, policy });
    }

    return NextResponse.json(apiError('VALIDATION_ERROR', 'Unknown task center command.', true), {
      status: 400,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), {
        status: error.status,
      });
    }

    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => issue.message).join('; ');
      return NextResponse.json(apiError('VALIDATION_ERROR', message, true), { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Task center command failed.';
    const lower = message.toLowerCase();
    const status = lower.includes('not found') ? 404 : lower.includes('invalid transition') ? 409 : 500;
    const errorCode = classifyTaskError({ message });

    logServerEvent('error', 'tasks.center.command.failed', {
      errorCode,
      message,
      status,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
