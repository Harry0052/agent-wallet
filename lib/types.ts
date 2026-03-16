// ============================================================
// Calico – Core Types
// A calm, premium, consumer-facing AI-native personal financial OS
// ============================================================

// -- Wallet --------------------------------------------------

export interface Wallet {
  balance: number;
  currency: string;
  transactions: Transaction[];
  settings: WalletSettings;
  recipients: Recipient[];
}

export interface SavedPaymentMethod {
  id: string;
  userId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  funding?: string | null;
  isDefault: boolean;
  status: 'active' | 'removed';
  consentedAt: string;
  consentMetadata?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalletSettings {
  maxTransaction: number;
  dailyLimit: number;
  monthlyBudget: number;
  approvalThreshold: number;
  requireLocation: boolean;
  allowedMerchants: string[];
  blockedMerchants: string[];
}

export type TransactionType =
  | 'topup'
  | 'receive'
  | 'send'
  | 'payout'
  | 'refund'
  | 'reversal'
  | 'subscription_debit';
export type TransactionDirection = 'credit' | 'debit';
export type TransactionStatus = 'pending' | 'succeeded' | 'failed' | 'canceled';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  currency: string;
  direction: TransactionDirection;
  stripeObjectId?: string;
  stripeEventId?: string;
  description: string;
  merchant?: string;
  recipientId?: string;
  status: TransactionStatus;
  source?: 'stripe' | 'apple-pay' | 'cashapp' | 'connect-transfer';
  metadata?: Record<string, string>;
  createdAt: string;
}

export interface Recipient {
  id: string;
  userId: string;
  name: string;
  sendMethod: 'cash_app' | 'stripe_connected' | 'bank';
  stripeAccountId?: string | null;
  cashAppCashtag?: string | null;
  bankReference?: string | null;
  aliases?: string[];
  defaultCurrency?: string;
  notes?: string;
  status: 'approved' | 'blocked' | 'pending';
  createdAt: string;
}

export interface UserAutofillProfile {
  userId: string;
  fullName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  billingName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateRegion?: string;
  postalCode?: string;
  country?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppUserSettings {
  userId: string;
  locale: string;
  timezone: string;
  dashboardDefaultView: 'home' | 'transactions' | 'subscriptions' | 'insights' | 'settings' | string;
  security: Record<string, unknown>;
  notifications: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

// -- Subscription Detection ----------------------------------

export interface DetectedSubscription {
  id: string;
  userId: string;
  merchant: string;
  amount: number;
  currency: string;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  confidence: number;
  status: 'active' | 'paused' | 'cancelled' | 'unknown';
  lastSeen: string;
  nextChargeDate?: string;
  priceChange?: {
    previousAmount: number;
    changeDetectedAt: string;
  };
  category?: string;
  createdAt: string;
  updatedAt: string;
}

// -- Insights ------------------------------------------------

export type InsightType =
  | 'unusual_spending'
  | 'price_increase'
  | 'waste'
  | 'category_drift'
  | 'found_money'
  | 'budget_risk';

export type InsightSeverity = 'info' | 'warning' | 'action_needed';
export type InsightStatus = 'active' | 'dismissed' | 'acted_on' | 'expired';

export interface Insight {
  id: string;
  userId: string;
  insightType: InsightType;
  title: string;
  summary: string;
  detail: Record<string, unknown>;
  severity: InsightSeverity;
  status: InsightStatus;
  relatedMerchant?: string;
  amountImpact?: number;
  generatedAt: string;
  dismissedAt?: string;
}

export interface SuggestedAction {
  id: string;
  userId: string;
  actionType: string;
  title: string;
  description: string;
  detail: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  insightId?: string;
  estimatedSavings?: number;
}

export interface NotificationPreferences {
  userId: string;
  emailInsights: boolean;
  pushInsights: boolean;
  weeklySummary: boolean;
  billReminders: boolean;
  unusualActivity: boolean;
}

// -- Engine Types ------------------------------------------

export type FinancialTaskType =
  | 'cancel_subscription'
  | 'review_charge'
  | 'reduce_spending'
  | 'fund_wallet'
  | 'move_to_savings'
  | 'reconnect_account';

export type FinancialTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'dismissed'
  | 'snoozed';

export type AutomationActionType =
  | 'subscription_cancel'
  | 'subscription_negotiate'
  | 'bill_pay'
  | 'savings_transfer'
  | 'debt_optimize'
  | 'expense_categorization'
  | 'refund_budget'
  | 'recurring_review'
  | 'trial_conversion_review'
  | 'bill_split';

export type AutomationPolicyMode =
  | 'suggest_only'
  | 'user_confirm_required'
  | 'autopilot_allowed';

export type AutomationActionStatus =
  | 'detected'
  | 'suggested'
  | 'pending_confirm'
  | 'attempted'
  | 'completed'
  | 'failed'
  | 'dismissed'
  | 'snoozed';

export interface AutomationExplainability {
  summary: string;
  factors: string[];
  confidence: number;
  coverageConfidence: number;
}

export interface AutomationActionRecord {
  id: string;
  userId: string;
  taskId: string;
  actionType: AutomationActionType;
  policy: AutomationPolicyMode;
  status: AutomationActionStatus;
  title: string;
  summary: string;
  dedupKey: string;
  confidence: number;
  coverageConfidence: number;
  explainability: AutomationExplainability;
  payload: Record<string, unknown>;
  amount: number | null;
  currency: string | null;
  requiresExplicitConfirmation: boolean;
  cooldownUntil: string | null;
  snoozedUntil: string | null;
  lastError: string | null;
  attemptedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  detectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationActionSummary {
  generatedAt: string;
  policyMode: AutomationPolicyMode;
  pendingConfirmCount: number;
  suggestedCount: number;
  activeCount: number;
  completed7dCount: number;
  failed7dCount: number;
  dismissed7dCount: number;
  topActions: Array<{
    id: string;
    title: string;
    actionType: AutomationActionType;
    status: AutomationActionStatus;
    confidence: number;
  }>;
}

export type CommandIntent =
  | 'query_spending'
  | 'query_subscription'
  | 'query_cashflow'
  | 'query_health'
  | 'affordability_check'
  | 'action_cancel_subscription'
  | 'action_move_money'
  | 'action_set_budget'
  | 'general_overview';
