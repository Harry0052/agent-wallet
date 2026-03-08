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

export type TransactionType = 'topup' | 'receive' | 'send' | 'payout' | 'refund' | 'reversal';
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
  status: 'approved' | 'blocked' | 'pending';
  createdAt: string;
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
  | 'thinking';      // agent "thinking" indicator

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  type: MessageType;
  data?: OptionsData | ApprovalData | ReceiptData | AgentLogData | FundingData;
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

export interface AgentTask {
  id: string;
  intent: string;
  category?: string;
  maxBudget: number;
  location?: string;
  status: 'active' | 'awaiting-approval' | 'completed' | 'cancelled';
  steps: AgentStep[];
  reasoningPlan?: string[];
  selectedOption?: VendorOption;
  startedAt: string;
  completedAt?: string;
}
