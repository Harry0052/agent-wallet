/**
 * ACP (Autonomous Control Plane) test fixtures.
 *
 * Provides mock data for both Playwright E2E tests and node:test unit tests.
 */

import type { AutomationActionRecord, AutomationActionSummary } from '@/lib/types';

// ── Mock AutomationActionRecord objects ─────────────────────────────────────

const baseAction: Omit<AutomationActionRecord, 'id' | 'status' | 'actionType' | 'title' | 'summary' | 'lastError' | 'attemptedAt' | 'completedAt' | 'dismissedAt'> = {
  userId: 'user-test-001',
  taskId: 'task-test-001',
  policy: 'user_confirm_required',
  dedupKey: 'dedup-test-001',
  confidence: 0.92,
  coverageConfidence: 0.88,
  explainability: {
    summary: 'Monthly charge detected with low usage.',
    factors: [
      'Subscription active for 8 months',
      'Average usage: 2 sessions/month',
      'Similar users saved $14.99/mo by canceling',
    ],
    confidence: 0.92,
    coverageConfidence: 0.88,
  },
  payload: {
    merchant: 'Netflix',
    targetService: 'netflix.com',
    planName: 'Standard',
  },
  amount: 15.49,
  currency: 'usd',
  requiresExplicitConfirmation: true,
  cooldownUntil: null,
  snoozedUntil: null,
  detectedAt: '2026-03-25T10:00:00.000Z',
  createdAt: '2026-03-25T10:00:00.000Z',
  updatedAt: '2026-03-25T10:00:00.000Z',
};

export const mockSuggestionAction: AutomationActionRecord = {
  ...baseAction,
  id: 'act-suggest-001',
  status: 'suggested',
  actionType: 'subscription_cancel',
  title: 'Cancel Netflix Standard',
  summary: 'You have been charged $15.49/mo for Netflix Standard but used it only twice last month.',
  lastError: null,
  attemptedAt: null,
  completedAt: null,
  dismissedAt: null,
};

export const mockPendingAction: AutomationActionRecord = {
  ...baseAction,
  id: 'act-pending-001',
  status: 'pending_confirm',
  actionType: 'subscription_cancel',
  title: 'Cancel Hulu Basic',
  summary: 'Hulu Basic has not been used in 60 days. Cancel to save $7.99/mo.',
  amount: 7.99,
  payload: { merchant: 'Hulu', targetService: 'hulu.com', planName: 'Basic' },
  lastError: null,
  attemptedAt: null,
  completedAt: null,
  dismissedAt: null,
};

export const mockAttemptedAction: AutomationActionRecord = {
  ...baseAction,
  id: 'act-attempted-001',
  status: 'attempted',
  actionType: 'subscription_cancel',
  title: 'Cancel Netflix Standard',
  summary: 'Cancellation is in progress for Netflix Standard.',
  lastError: null,
  attemptedAt: '2026-03-25T10:05:00.000Z',
  completedAt: null,
  dismissedAt: null,
};

export const mockCompletedAction: AutomationActionRecord = {
  ...baseAction,
  id: 'act-completed-001',
  status: 'completed',
  actionType: 'subscription_cancel',
  title: 'Cancel Netflix Standard',
  summary: 'Netflix Standard subscription has been canceled successfully.',
  lastError: null,
  attemptedAt: '2026-03-25T10:05:00.000Z',
  completedAt: '2026-03-25T10:05:30.000Z',
  dismissedAt: null,
  explainability: {
    summary: 'Cancellation confirmed. Effective end of billing period March 31.',
    factors: ['Subscription active for 8 months', 'Low usage detected'],
    confidence: 0.95,
    coverageConfidence: 0.90,
  },
};

export const mockFailedAction: AutomationActionRecord = {
  ...baseAction,
  id: 'act-failed-001',
  status: 'failed',
  actionType: 'subscription_cancel',
  title: 'Cancel Netflix Standard',
  summary: 'Attempted to cancel Netflix Standard but the operation failed.',
  lastError: 'Login credentials were rejected after one retry.',
  attemptedAt: '2026-03-25T10:05:00.000Z',
  completedAt: null,
  dismissedAt: null,
};

export const mockBlockedAction: AutomationActionRecord = {
  ...baseAction,
  id: 'act-blocked-001',
  status: 'failed',
  actionType: 'subscription_cancel',
  title: 'Cancel Disney+ Monthly',
  summary: 'Attempted to cancel Disney+ but was blocked by a captcha challenge.',
  lastError: 'Execution halted: captcha challenge detected on the cancellation page.',
  amount: 13.99,
  payload: { merchant: 'Disney+', targetService: 'disneyplus.com' },
  attemptedAt: '2026-03-25T10:08:00.000Z',
  completedAt: null,
  dismissedAt: null,
};

// ── Mock SSE events (TinyFish-style) ────────────────────────────────────────

export const mockSseEvents = [
  { type: 'step_started', step: 'Navigate to Netflix account', stepIndex: 1, totalSteps: 6, site: 'netflix.com', elapsed: 0 },
  { type: 'step_completed', step: 'Navigate to Netflix account', stepIndex: 1, totalSteps: 6, elapsed: 2100 },
  { type: 'step_started', step: 'Log in to your account', stepIndex: 2, totalSteps: 6, site: 'netflix.com', elapsed: 2200 },
  { type: 'step_completed', step: 'Log in to your account', stepIndex: 2, totalSteps: 6, elapsed: 5400 },
  { type: 'step_started', step: 'Locate active subscription', stepIndex: 3, totalSteps: 6, site: 'netflix.com', elapsed: 5500 },
  { type: 'step_completed', step: 'Locate active subscription', stepIndex: 3, totalSteps: 6, elapsed: 7200 },
  { type: 'step_started', step: 'Start cancellation flow', stepIndex: 4, totalSteps: 6, site: 'netflix.com', elapsed: 7300 },
  { type: 'step_completed', step: 'Start cancellation flow', stepIndex: 4, totalSteps: 6, elapsed: 9800 },
  { type: 'step_started', step: 'Confirm cancellation', stepIndex: 5, totalSteps: 6, site: 'netflix.com', elapsed: 9900 },
  { type: 'step_completed', step: 'Confirm cancellation', stepIndex: 5, totalSteps: 6, elapsed: 12000 },
  { type: 'step_started', step: 'Capture confirmation details', stepIndex: 6, totalSteps: 6, site: 'netflix.com', elapsed: 12100 },
  { type: 'evidence_captured', evidenceType: 'confirmation_number', label: 'Confirmation reference', stepIndex: 6, totalSteps: 6, elapsed: 13500 },
  { type: 'step_completed', step: 'Capture confirmation details', stepIndex: 6, totalSteps: 6, elapsed: 14000 },
  { type: 'completed', confirmation: 'Your Netflix Standard subscription has been canceled.', evidence: { merchant: 'Netflix', referenceNumber: 'NF-20260325-X9K4' }, elapsed: 15000, totalSteps: 6 },
];

// ── Mock journal entries ────────────────────────────────────────────────────

export const mockJournalEntries = [
  {
    eventId: 'evt-001',
    eventType: 'status_change',
    fromStatus: 'attempted',
    toStatus: 'completed',
    reason: 'Subscription canceled successfully.',
    idempotencyKey: 'confirm:1711360000000:abc12345',
    metadata: { provider: 'tinyfish', taskId: 'tf-001' },
    renderedGoal: 'Cancel Netflix Standard subscription...',
    tinyFishResult: { status: 'completed', stepsCompleted: 6 },
    eventCreatedAt: '2026-03-25T10:05:30.000Z',
    actionId: 'act-completed-001',
    actionType: 'subscription_cancel',
    actionTitle: 'Cancel Netflix Standard',
    actionSummary: 'Netflix Standard subscription has been canceled successfully.',
    actionStatus: 'completed',
    actionAmount: 15.49,
    actionCurrency: 'usd',
    actionCreatedAt: '2026-03-25T10:00:00.000Z',
    rollbackPossible: false,
    rollbackNotes: null,
  },
  {
    eventId: 'evt-002',
    eventType: 'status_change',
    fromStatus: 'attempted',
    toStatus: 'failed',
    reason: 'Login credentials rejected.',
    idempotencyKey: 'attempt:1711360100000:def67890',
    metadata: { provider: 'tinyfish', taskId: 'tf-002' },
    renderedGoal: null,
    tinyFishResult: { status: 'failed', failureReason: 'login_failed' },
    eventCreatedAt: '2026-03-25T09:45:00.000Z',
    actionId: 'act-failed-001',
    actionType: 'subscription_cancel',
    actionTitle: 'Cancel Netflix Standard',
    actionSummary: 'Attempted to cancel Netflix Standard but the operation failed.',
    actionStatus: 'failed',
    actionAmount: 15.49,
    actionCurrency: 'usd',
    actionCreatedAt: '2026-03-25T09:30:00.000Z',
    rollbackPossible: false,
    rollbackNotes: null,
  },
];

// ── Mock policy config ──────────────────────────────────────────────────────

export const mockPolicyConfig = {
  defaultMode: 'user_confirm_required' as const,
  perActionMode: {} as Record<string, string>,
  autopilotEnabledActions: {
    expense_categorization: true,
    refund_budget: true,
    recurring_review: false,
    subscription_cancel: false,
    subscription_negotiate: false,
    trial_conversion_review: false,
    savings_transfer: false,
    bill_pay: false,
    debt_optimize: false,
    bill_split: false,
  },
  explicitConfirmEnabledActions: {
    subscription_cancel: true,
    bill_pay: true,
    debt_optimize: true,
  },
};

// ── Mock summary ────────────────────────────────────────────────────────────

export const mockSummary: AutomationActionSummary = {
  generatedAt: '2026-03-25T10:00:00.000Z',
  policyMode: 'user_confirm_required',
  pendingConfirmCount: 1,
  suggestedCount: 2,
  activeCount: 0,
  completed7dCount: 1,
  failed7dCount: 1,
  dismissed7dCount: 0,
  topActions: [
    {
      id: 'act-suggest-001',
      title: 'Cancel Netflix Standard',
      actionType: 'subscription_cancel',
      status: 'suggested',
      confidence: 0.92,
    },
  ],
};

// ── Mock TaskCenterSnapshot ─────────────────────────────────────────────────

export const mockSnapshot = {
  actions: [
    mockSuggestionAction,
    mockPendingAction,
    mockCompletedAction,
    mockFailedAction,
  ],
  summary: mockSummary,
  events: [
    {
      id: 'evt-001',
      userId: 'user-test-001',
      actionId: 'act-completed-001',
      eventType: 'status_change',
      fromStatus: 'attempted',
      toStatus: 'completed',
      reason: 'Subscription canceled.',
      idempotencyKey: null,
      metadata: null,
      createdAt: '2026-03-25T10:05:30.000Z',
    },
  ],
  policy: mockPolicyConfig,
};
