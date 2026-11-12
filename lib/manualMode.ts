import { migrateLegacyBrowserStorage } from "@/lib/browserStorage";

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
  accounts: "agent-wallet.manual.accounts",
  netWorthHistory: "agent-wallet.manual.networth-history",
  transactions: "agent-wallet.manual.transactions",
  recurring: "agent-wallet.manual.recurring",
  budgets: "agent-wallet.manual.budgets",
  goals: "agent-wallet.manual.goals",
  cashflow: "agent-wallet.manual.cashflow",
  reports: "agent-wallet.manual.reports",
  investments: "agent-wallet.manual.investments",
  netWorth: "agent-wallet.manual.networth",
} as const;

export function readLocalStorageJson<T>(key: string, fallback: T): T {
  migrateLegacyBrowserStorage();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
