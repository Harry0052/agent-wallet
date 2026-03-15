import type { Wallet } from "@/lib/types";
import type { SmartHomePayload } from "@/services/smartWallet";
import type { ConnectedAccountRecord } from "@/services/connect";
import type { DetectedSubscription, StatementTransaction } from "@/services/statements";

export type DashboardWidgetId =
  | "budget"
  | "creditScore"
  | "netWorth"
  | "goals"
  | "gettingStarted"
  | "spending"
  | "transactions"
  | "recurring"
  | "investments"
  | "advice";

export type DashboardWidgetSpan = "compact" | "wide" | "full";

export interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  label: string;
  description: string;
  span: DashboardWidgetSpan;
}

export interface DashboardPreferences {
  order: DashboardWidgetId[];
  visibility: Record<DashboardWidgetId, boolean>;
  useLiveData: boolean;
}

export interface DashboardInvestmentHolding {
  id: string;
  symbol: string;
  name: string;
  value: number;
  changePct: number;
}

export interface DashboardDataSource {
  accounts: ConnectedAccountRecord[];
  transactions: StatementTransaction[];
  recurring: DetectedSubscription[];
  investments: DashboardInvestmentHolding[];
}

export interface DashboardWidgetProps {
  home: SmartHomePayload;
  wallet: Wallet | null;
  dataSource: DashboardDataSource;
  accountsConnected: boolean;
  useLiveData: boolean;
}
