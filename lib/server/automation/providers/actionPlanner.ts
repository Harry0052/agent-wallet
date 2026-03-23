import type { AutomationActionType } from '@/lib/types';
import type { ExecutionStep, ExecutionRiskLevel } from './types';
import { getSupportedAction } from './types';

// ── Action Planner ──────────────────────────────────────────────────────────
// Converts a classified intent into a step-by-step execution plan.
// The plan is shown to the user before approval and drives the execution flow.

export interface ActionPlan {
  actionType: AutomationActionType;
  targetService: string;
  summary: string;
  steps: ExecutionStep[];
  riskLevel: ExecutionRiskLevel;
  requiresCredentials: boolean;
  requiresOtp: boolean;
  estimatedDuration: string;
  warnings: string[];
  possibleOutcome: string;
}

/** Build step templates for each action type */
function buildSteps(actionType: AutomationActionType, targetService: string): ExecutionStep[] {
  const step = (id: string, label: string): ExecutionStep => ({
    id,
    label,
    status: 'pending',
  });

  switch (actionType) {
    case 'subscription_cancel':
      return [
        step('navigate', `Navigate to ${targetService} account`),
        step('authenticate', 'Log in to your account'),
        step('find_subscription', 'Locate active subscription'),
        step('initiate_cancel', 'Start cancellation flow'),
        step('handle_retention', 'Decline retention offers if presented'),
        step('confirm_cancel', 'Confirm cancellation'),
        step('verify', 'Verify cancellation is confirmed'),
        step('capture_proof', 'Capture confirmation details'),
      ];

    case 'subscription_negotiate':
      return [
        step('navigate', `Navigate to ${targetService} account`),
        step('authenticate', 'Log in to your account'),
        step('find_plan', 'Identify current plan and pricing'),
        step('check_offers', 'Check available offers and retention deals'),
        step('contact_support', 'Initiate support conversation'),
        step('negotiate', 'Present request for lower rate'),
        step('evaluate_offer', 'Evaluate the offer received'),
        step('capture_result', 'Document the outcome'),
      ];

    case 'recurring_review':
      return [
        step('scan', 'Scan your transactions for recurring charges'),
        step('identify', 'Identify active subscriptions'),
        step('analyze', 'Analyze usage and value'),
        step('report', 'Prepare review summary with recommendations'),
      ];

    case 'expense_categorization':
      return [
        step('identify', 'Identify the transaction'),
        step('analyze', 'Determine correct category'),
        step('update', 'Update the category'),
        step('learn', 'Save the correction for future transactions'),
      ];

    case 'trial_conversion_review':
      return [
        step('scan', 'Scan for active free trials'),
        step('check_dates', 'Check conversion dates'),
        step('evaluate', 'Assess whether to keep or cancel'),
        step('report', 'Present findings with cancel option'),
      ];

    case 'savings_transfer':
      return [
        step('calculate', 'Calculate safe transfer amount'),
        step('verify_account', 'Verify savings account connection'),
        step('initiate', 'Initiate transfer'),
        step('confirm', 'Confirm transfer completed'),
      ];

    case 'bill_pay':
      return [
        step('identify', `Identify ${targetService} bill details`),
        step('verify_amount', 'Verify payment amount'),
        step('verify_method', 'Verify payment method'),
        step('initiate', 'Initiate payment'),
        step('confirm', 'Confirm payment processed'),
      ];

    case 'debt_optimize':
      return [
        step('analyze', 'Analyze current debt positions'),
        step('calculate', 'Calculate optimal payment strategy'),
        step('plan', 'Generate payment reallocation plan'),
        step('present', 'Present recommendations'),
      ];

    case 'bill_split':
      return [
        step('identify', 'Identify the expense to split'),
        step('calculate', 'Calculate split amounts'),
        step('prepare', 'Prepare split request'),
        step('send', 'Send request to recipient'),
      ];

    case 'refund_budget':
      return [
        step('identify', 'Identify the refund'),
        step('calculate', 'Calculate budget reallocation'),
        step('apply', 'Apply budget adjustment'),
      ];

    default:
      return [step('execute', 'Execute action')];
  }
}

function estimateDuration(actionType: AutomationActionType): string {
  switch (actionType) {
    case 'subscription_cancel':
    case 'subscription_negotiate':
      return '2-5 minutes';
    case 'recurring_review':
    case 'trial_conversion_review':
      return 'Under 1 minute';
    case 'expense_categorization':
    case 'refund_budget':
      return 'A few seconds';
    case 'savings_transfer':
    case 'bill_pay':
    case 'debt_optimize':
      return '1-3 minutes';
    default:
      return '1-5 minutes';
  }
}

function buildWarnings(actionType: AutomationActionType, targetService: string): string[] {
  const warnings: string[] = [];

  const def = getSupportedAction(actionType);
  if (def && !def.live) {
    warnings.push('This action type is not yet fully wired. Calico will create the plan but cannot execute automatically.');
  }

  if (actionType === 'subscription_cancel') {
    warnings.push(`Canceling ${targetService} may be irreversible. You may lose access immediately or at the end of your billing cycle.`);
  }

  if (actionType === 'subscription_negotiate') {
    warnings.push('Negotiation outcomes depend on the service provider. Calico will attempt but cannot guarantee a lower rate.');
  }

  if (actionType === 'bill_pay') {
    warnings.push('This will initiate a real payment. Please verify the amount and payment method before approving.');
  }

  return warnings;
}

function buildOutcome(actionType: AutomationActionType, targetService: string): string {
  switch (actionType) {
    case 'subscription_cancel':
      return `Your ${targetService} subscription will be canceled. You may retain access until the end of your billing period.`;
    case 'subscription_negotiate':
      return `Calico will attempt to secure a lower rate for ${targetService}. You'll see the offer before any changes are made.`;
    case 'recurring_review':
      return 'You\'ll receive a summary of all recurring charges with recommendations on what to keep, cancel, or investigate.';
    case 'expense_categorization':
      return 'The transaction will be moved to the correct category and Calico will learn from this correction.';
    case 'trial_conversion_review':
      return 'You\'ll see which trials are about to convert, with the option to cancel before being charged.';
    case 'savings_transfer':
      return 'A safe amount will be transferred to your savings account based on your current affordability.';
    case 'bill_pay':
      return `Your ${targetService} bill will be paid using your default payment method.`;
    default:
      return 'The action will be completed and you\'ll receive a summary of what happened.';
  }
}

/**
 * Create an execution plan for a classified intent.
 * This plan is shown to the user for approval before execution begins.
 */
export function createActionPlan(input: {
  actionType: AutomationActionType;
  targetService: string;
}): ActionPlan {
  const def = getSupportedAction(input.actionType);

  return {
    actionType: input.actionType,
    targetService: input.targetService,
    summary: def?.description ?? 'Execute the requested action',
    steps: buildSteps(input.actionType, input.targetService),
    riskLevel: def?.riskLevel ?? 'medium',
    requiresCredentials: def?.requiresCredentials ?? false,
    requiresOtp: input.actionType === 'subscription_cancel' || input.actionType === 'bill_pay',
    estimatedDuration: estimateDuration(input.actionType),
    warnings: buildWarnings(input.actionType, input.targetService),
    possibleOutcome: buildOutcome(input.actionType, input.targetService),
  };
}
