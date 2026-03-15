import type { SourceState } from "@/lib/server/smartHome";

export type SmartSurfaceIntent =
  | "lower_bills"
  | "review_unusual_spend"
  | "plan_cash_30d"
  | "check_connection_health"
  | "query_spending"
  | "query_health"
  | "affordability_check"
  | "overview";

export interface SmartSurfaceAction {
  label: string;
  href: string;
}

export interface SmartSurfaceResult {
  title: string;
  sourceState: SourceState;
  summary: string;
  whyThisResult: string;
  canDoNow: string;
  checklist: string[];
  actions: SmartSurfaceAction[];
}

export interface SmartSurfaceContext {
  generatedAt: string;
  wallet: {
    balance: number;
    currency: string;
    fundingMethodCount: number;
  };
  statements: {
    transactionCount: number;
    anomalousChargeCount: number;
    hasRecentData: boolean;
  };
  recurring: {
    count: number;
    monthlyTotal: number;
    cancellationCandidateMonthlyTotal: number;
  };
  connectionHealth: {
    accountCount: number;
    appCount: number;
    staleAccountCount: number;
    hasAnyConnectedSource: boolean;
  };
  dataState: {
    sourceState: SourceState;
    lowData: boolean;
    lowDataReason: string | null;
  };
  trust: {
    knows: string;
    infers: string;
    recommends: string;
    canDo: string;
  };
}
