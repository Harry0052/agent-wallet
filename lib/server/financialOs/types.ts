export type FinancialTimelineEventKind =
  | "payday"
  | "bill"
  | "subscription"
  | "task"
  | "anomaly"
  | "transfer"
  | "goal";

export type FinancialTimelineEventPriority = "low" | "medium" | "high" | "critical";

export interface FinancialTimelineEvent {
  id: string;
  kind: FinancialTimelineEventKind;
  title: string;
  summary: string;
  occurredAt: string;
  direction: "past" | "upcoming";
  amount: number | null;
  currency: string | null;
  priority: FinancialTimelineEventPriority;
  deepLink: string;
  confidence: number;
  explainability: {
    summary: string;
    factors: string[];
  };
}

export interface FinancialTransferPair {
  debitTransactionId: string;
  creditTransactionId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  occurredAt: string;
  confidence: number;
}

export interface FinancialAccountFlowSummary {
  accountId: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface CrossAccountMoneyFlowAnalysis {
  internalTransferAmount: number;
  trueSpendAmount: number;
  trueIncomeAmount: number;
  netCashFlow: number;
  transferPairs: FinancialTransferPair[];
  byAccount: FinancialAccountFlowSummary[];
  confidence: number;
  explanation: string;
  factors: string[];
}

export type FinancialMemoryKey =
  | "category_corrections"
  | "dismissed_insights"
  | "snoozed_tasks"
  | "recurring_behaviors"
  | "preferences";

export interface FinancialMemoryEntry {
  key: FinancialMemoryKey;
  updatedAt: string;
  data: Record<string, unknown>;
}

export interface FinancialMemorySnapshot {
  entries: FinancialMemoryEntry[];
  confidence: number;
  explanation: string;
}

export type FinancialNotificationPriority = "low" | "medium" | "high" | "critical";

export interface FinancialNotification {
  id: string;
  kind: string;
  dedupKey: string;
  title: string;
  summary: string;
  priority: FinancialNotificationPriority;
  status: "active" | "dismissed" | "suppressed";
  deepLink: string;
  cooldownUntil: string | null;
  throttledCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialDocumentHook {
  id: string;
  userId: string;
  documentType: "statement" | "bill" | "receipt" | "confirmation";
  status: "hooked" | "processed" | "failed";
  fileName: string;
  mimeType: string;
  sourceHash: string | null;
  storageProvider: string | null;
  hasEncryptedReference: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialDocumentSummary {
  total: number;
  byType: Record<FinancialDocumentHook["documentType"], number>;
  recent: FinancialDocumentHook[];
}

export interface FinancialSyncRunSummary {
  id: string;
  userId: string;
  plaidItemId: string;
  status: "processing" | "completed" | "failed" | "skipped";
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  pages: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface UnifiedFinancialAccountDashboard {
  generatedAt: string;
  accounts: Array<{
    id: string;
    institutionName: string;
    nickname: string;
    accountType: string;
    mask: string;
    lastSyncedAt: string | null;
    syncFresh: boolean;
  }>;
  institutions: Array<{
    institutionName: string;
    accountCount: number;
  }>;
  sync: {
    connectedAccountCount: number;
    freshAccountCount: number;
    staleAccountCount: number;
    recentRuns: FinancialSyncRunSummary[];
  };
  moneyFlow: CrossAccountMoneyFlowAnalysis;
  timeline: FinancialTimelineEvent[];
  memory: FinancialMemorySnapshot;
  notifications: FinancialNotification[];
  taskCenter: {
    pendingConfirmCount: number;
    activeCount: number;
    completed7dCount: number;
    failed7dCount: number;
    topActions: Array<{
      id: string;
      title: string;
      status: string;
      actionType: string;
      confidence: number;
    }>;
  };
  documents: FinancialDocumentSummary;
}

export interface DeterministicReceiptLineItem {
  label: string;
  amount: number;
}

export interface DeterministicReceiptParseResult {
  merchant: string | null;
  date: string | null;
  currency: string;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  lineItems: DeterministicReceiptLineItem[];
  confidence: number;
  fallbackUsed: boolean;
  extractionMethod: "deterministic" | "llm_fallback";
  missingFields: string[];
  explainability: {
    summary: string;
    factors: string[];
  };
}
