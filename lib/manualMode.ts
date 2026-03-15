export type RecordSourceType = "connected" | "manual";

export type ManualAccountType =
  | "checking"
  | "savings"
  | "cash"
  | "credit"
  | "loan"
  | "investment"
  | "other_asset"
  | "other_liability";

export interface ManualAccountRecord {
  id: string;
  name: string;
  type: ManualAccountType;
  balance: number;
  updatedAt: string;
  sourceType: "manual";
  mask?: string;
  institutionName?: string;
  notes?: string;
  lastUpdated?: string;
}

export interface ManualNetWorthItem {
  id: string;
  label: string;
  kind: "asset" | "liability";
  category: string;
  amount: number;
  updatedAt: string;
  sourceType: "manual";
}

export type ManualRecurringKind = "income" | "expense";

export interface ManualInvestmentHolding {
  id: string;
  symbol: string;
  ticker?: string;
  name: string;
  quantity: number;
  shares: number;
  averageCost?: number;
  currentValue: number;
  value: number;
  accountName?: string;
  notes?: string;
  sourceType: "manual";
}

export const MANUAL_STORAGE_KEYS = {
  accounts: "calico.manual.accounts",
  netWorthHistory: "calico.manual.networth-history",
  transactions: "calico.manual.transactions",
  recurring: "calico.manual.recurring",
  budgets: "calico.manual.budgets",
  goals: "calico.manual.goals",
  cashflow: "calico.manual.cashflow",
  reports: "calico.manual.reports",
  investments: "calico.manual.investments",
  netWorth: "calico.manual.networth",
} as const;

export function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
