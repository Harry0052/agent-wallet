// ============================================================
// Agent Wallet – Core Types
// A chat-first autonomous wallet for AI web agents
// ============================================================

// -- Wallet --------------------------------------------------

export interface Wallet {
  balance: number;
  currency: string;
  transactions: Transaction[];
  settings: WalletSettings;
  recipients: Recipient[];
}

export interface WalletSettings {
  maxTransaction: number;        // max per single transaction
  dailyLimit: number;            // daily spend limit
  monthlyBudget: number;         // monthly spend limit
  approvalThreshold: number;     // require approval at/above this amount
  requireLocation: boolean;      // ask for location on purchase tasks
  allowedMerchants: string[];    // empty => allow all except blocked
  blockedMerchants: string[];    // always denied
}

export type TransactionType =
  | 'topup'
  | 'receive'
  | 'send'
  | 'payout'
  | 'refund'
  | 'reversal'
  | 'procurement_commitment'
  | 'subscription_savings_projection';
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
  stripeAccountId: string;
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

// -- Chat ----------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageType =
  | 'text'
  | 'options'       // vendor/product choices
  | 'approval'      // approve/reject prompt
  | 'receipt'        // purchase receipt
  | 'funding'        // add-funds request
  | 'agent-log'      // TinyFish action log
  | 'evidence'       // TinyFish extracted evidence
  | 'thinking'       // agent "thinking" indicator
  | 'task-progress'; // live task state machine progress

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  type: MessageType;
  data?: OptionsData | ApprovalData | ReceiptData | AgentLogData | FundingData | EvidenceData | TaskProgressData;
  timestamp: string;
}

export interface OptionsData {
  options: VendorOption[];
  recommendedId?: string;
}

export interface VendorOption {
  id: string;
  name: string;
  item: string;
  price: number;
  distance?: string;
  rating?: number;
  url?: string;
  tags?: string[];
}

export interface ApprovalData {
  merchant: string;
  item: string;
  amount: number;
  taskId: string;
}

export interface ReceiptData {
  merchant: string;
  item: string;
  amount: number;
  previousBalance: number;
  newBalance: number;
  transactionId: string;
}

export interface FundingData {
  amount: number;
}

export interface AgentLogData {
  steps: AgentStep[];
}

export interface EvidenceRecord {
  vendorName: string;
  planName: string;
  price: number;
  billingFrequency: string;
  keyFeatures: string[];
  sourceUrl: string;
  extractedAt: string;
}

export interface EvidenceData {
  findings: EvidenceRecord[];
}

// -- Procurement ---------------------------------------------

export interface ProcurementBudgetConstraint {
  amount: number | null;
  currency: 'USD';
  period: 'monthly' | 'yearly' | 'one_time' | 'unknown';
  rawText?: string;
}

export interface ProcurementPlan {
  normalizedGoal: string;
  category: string;
  targetVendorCandidates: string[];
  budgetConstraint: ProcurementBudgetConstraint;
  mustHaveFeatures: string[];
  comparisonCriteria: string[];
  clarificationNeeded: boolean;
  followUpQuestions: string[];
}

export interface ProcurementTaskRecord {
  id: string;
  userId: string;
  taskType: string;
  status:
  | 'planning'
  | 'planned'
  | 'needs_clarification'
  | 'researching'
  | 'researched'
  | 'comparing'
  | 'awaiting_approval'
  | 'purchase_preparing'
  | 'purchase_prepared'
  | 'rejected'
  | 'failed';
  goal: string;
  budgetLimit: number | null;
  category: string | null;
  targetVendors: string[];
  comparisonCriteria: string[];
  mustHaveFeatures: string[];
  findings: Record<string, unknown> | null;
  recommendation: Record<string, unknown> | null;
  planningOutput: ProcurementPlan;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcurementFinding {
  id: string;
  taskId: string;
  userId: string;
  vendorName: string;
  pricingPageUrl: string;
  planName: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  billingFrequency: string;
  contentAvailability?: string | null;
  notes?: string | null;
  notableFeatures: string[];
  extractionTimestamp: string;
  createdAt: string;
}

export interface ProcurementResearchLog {
  id: string;
  taskId: string;
  actionType: string;
  status: 'running' | 'done' | 'error';
  message: string;
  url?: string;
  phase?: string;
  event?: string;
  code?: string;
  createdAt: string;
}

export interface ProcurementLifecycleState {
  phase: 'planning' | 'researching' | 'comparing' | 'approval' | 'purchase_prep' | 'subscription_ops' | 'failed';
  canRetry: boolean;
  retryHint?: string;
}

export interface ProcurementRecommendationOption {
  findingId: string;
  vendorName: string;
  planName: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  billingFrequency: string;
  contentAvailability?: string | null;
  notes?: string | null;
  pricingPageUrl: string;
  notableFeatures: string[];
  extractionTimestamp: string;
}

export interface ProcurementPolicyCheck {
  key: string;
  label: string;
  passed: boolean;
  blocking: boolean;
  detail: string;
}

export interface ProcurementPolicyResult {
  allowed: boolean;
  approvalRequired: boolean;
  amountEvaluated: number | null;
  amountBasis: 'monthly' | 'annual' | 'unknown';
  currency: 'USD';
  checks: ProcurementPolicyCheck[];
  reason?: string;
  evaluatedAt: string;
}

export interface ProcurementApprovalState {
  decision: 'approved' | 'rejected';
  decidedAt: string;
}

export interface ProcurementLedgerPreview {
  entryId: string;
  type: 'procurement_commitment';
  status: 'pending';
  amount: number;
  currency: string;
  description: string;
}

export interface ProcurementPurchasePrepState {
  status: 'running' | 'prepared' | 'failed';
  preparedAt?: string;
  checkoutUrl?: string;
  proofUrls: string[];
  pendingLedgerEntry?: ProcurementLedgerPreview;
  blocker?: {
    code: string;
    message: string;
    missingFields: string[];
    sensitive: boolean;
    canResume: boolean;
  };
  error?: string;
}

export interface ProcurementRecommendationRecord {
  engineVersion: string;
  generatedAt: string;
  goal: string;
  budgetLimit: number | null;
  budgetAssessment: 'fits_budget' | 'mixed' | 'over_budget' | 'unknown';
  noFitExplanation: string | null;
  confidence?: number;
  exceptions?: string[];
  winner: ProcurementRecommendationOption | null;
  alternatives: ProcurementRecommendationOption[];
  whyWinner: string[];
  evidenceLinks?: string[];
  policy: ProcurementPolicyResult | null;
  approval?: ProcurementApprovalState;
  purchasePrep?: ProcurementPurchasePrepState;
}

export type SubscriptionOperationType =
  | 'inspect_billing'
  | 'renewal_check'
  | 'downgrade'
  | 'cancel'
  | 'switch_billing';

export type SubscriptionOperationStatus = 'running' | 'completed' | 'blocked' | 'failed';

export interface ActiveSubscriptionTask {
  taskId: string;
  title: string;
  vendorName: string;
  planName: string;
  amount: number | null;
  amountBasis: 'monthly' | 'annual' | 'unknown';
  billingFrequency: string;
  sourceUrl: string;
  approvedAt?: string;
  taskStatus: ProcurementTaskRecord['status'];
}

export interface SubscriptionActionRecord {
  id: string;
  userId: string;
  taskId: string;
  operation: SubscriptionOperationType;
  status: SubscriptionOperationStatus;
  summary?: string;
  evidenceUrls: string[];
  projectedSavings: number | null;
  projectedSavingsBasis: 'monthly' | 'annual' | 'unknown';
  currency: string | null;
  renewalDate?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// -- Agent / TinyFish ----------------------------------------

export type AgentStepType =
  | 'search'
  | 'visit'
  | 'extract'
  | 'compare'
  | 'select'
  | 'checkout'
  | 'form-fill'
  | 'confirm'
  | 'plan'
  | 'guardrail'
  | 'payment';

export type AgentStepStatus = 'running' | 'done' | 'error';

export interface AgentStep {
  id: string;
  type: AgentStepType;
  description: string;
  url?: string;
  status: AgentStepStatus;
  timestamp: string;
}

export type TaskState =
  | 'received'
  | 'parsing'
  | 'needs_clarification'
  | 'resolving_recipient'
  | 'ready_to_execute'
  | 'executing'
  | 'awaiting_approval'
  | 'completed'
  | 'failed';

export interface TaskProgressData {
  taskState: TaskState;
  stateHistory: Array<{ state: TaskState; label: string; timestamp: string }>;
}

export interface AgentTask {
  id: string;
  intent: string;
  category?: string;
  maxBudget: number;
  location?: string;
  status: 'active' | 'awaiting-approval' | 'completed' | 'cancelled';
  taskState: TaskState;
  steps: AgentStep[];
  reasoningPlan?: string[];
  selectedOption?: VendorOption;
  recipientId?: string;
  startedAt: string;
  completedAt?: string;
  pendingRecipientName?: string;
  pendingAmount?: number;
}
