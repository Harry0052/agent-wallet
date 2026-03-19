import 'server-only';

import type { PlanId } from '@/lib/server/billing';

// ── Feature definitions ─────────────────────────────────────────────────────

export type FeatureKey =
  | 'core_dashboard'
  | 'basic_transactions'
  | 'basic_budgets'
  | 'basic_insights'
  | 'recurring_detection'
  | 'monthly_summaries'
  | 'limited_accounts'
  | 'net_worth'
  | 'spending_categories'
  | 'monthly_cashflow'
  | 'manual_entry'
  | 'simple_goals'
  | 'income_expense_chart'
  | 'category_breakdowns'
  | 'basic_alerts'
  | 'advanced_insights'
  | 'spending_trends'
  | 'smart_savings'
  | 'custom_categories'
  | 'unlimited_accounts'
  | 'priority_support'
  | 'ai_research'
  | 'cashflow_forecast'
  | 'ai_automation'
  | 'autonomous_actions'
  | 'bill_negotiation'
  | 'advanced_forecasting'
  | 'financial_memory'
  | 'custom_integrations'
  | 'api_access'
  | 'premium_intelligence';

export interface FeatureDefinition {
  key: FeatureKey;
  label: string;
  description: string;
  minimumPlan: PlanId;
}

export const FEATURES: FeatureDefinition[] = [
  // ── Starter — "Help me see where I stand" ──
  // Clarity: see your money, know the basics, no analysis or advice
  { key: 'core_dashboard', label: 'Money Dashboard', description: 'Your whole money picture in one calm place', minimumPlan: 'starter' },
  { key: 'limited_accounts', label: 'Up to 3 Accounts', description: 'Connect up to 3 bank or card accounts', minimumPlan: 'starter' },
  { key: 'net_worth', label: 'Net Worth Tracking', description: 'Track assets minus liabilities across all accounts', minimumPlan: 'starter' },
  { key: 'basic_transactions', label: 'Transaction Feed', description: 'See spending and income as it happens', minimumPlan: 'starter' },
  { key: 'spending_categories', label: 'Auto-Categories', description: 'Transactions sorted into categories automatically', minimumPlan: 'starter' },
  { key: 'monthly_cashflow', label: 'Cash Flow View', description: 'Monthly money in vs. money out', minimumPlan: 'starter' },
  { key: 'basic_budgets', label: 'Simple Budgets', description: 'Set a basic monthly spending plan', minimumPlan: 'starter' },
  { key: 'monthly_summaries', label: 'Monthly Summary', description: 'A clear recap of where your money went', minimumPlan: 'starter' },
  { key: 'manual_entry', label: 'Manual Entry', description: 'Add accounts and transactions by hand', minimumPlan: 'starter' },

  // ── Pro — "Help me understand what to do next" ──
  // Guidance: goals, insights, trends, alerts — Calico explains and advises
  { key: 'unlimited_accounts', label: 'Unlimited Accounts', description: 'Connect as many accounts as you need', minimumPlan: 'pro' },
  { key: 'simple_goals', label: 'Money Goals', description: 'Set savings targets and track progress', minimumPlan: 'pro' },
  { key: 'income_expense_chart', label: 'Income vs. Expense', description: 'Visual comparison of what you earn and spend', minimumPlan: 'pro' },
  { key: 'spending_trends', label: 'Spending Trends', description: 'See how your spending changes over time', minimumPlan: 'pro' },
  { key: 'category_breakdowns', label: 'Category Breakdown', description: 'Detailed view of where money goes by category', minimumPlan: 'pro' },
  { key: 'recurring_detection', label: 'Recurring Detection', description: 'Bills and subscriptions found automatically', minimumPlan: 'pro' },
  { key: 'basic_alerts', label: 'Smart Alerts', description: 'Notified about unusual spending and important changes', minimumPlan: 'pro' },
  { key: 'basic_insights', label: 'AI Insights', description: 'AI-powered analysis and tips about your money', minimumPlan: 'pro' },
  { key: 'advanced_insights', label: 'Deep Analysis', description: 'Deeper explanations of patterns and opportunities', minimumPlan: 'pro' },
  { key: 'smart_savings', label: 'Savings Suggestions', description: 'Calico finds ways you could save more', minimumPlan: 'pro' },
  { key: 'custom_categories', label: 'Custom Categories', description: 'Organize spending into your own groups', minimumPlan: 'pro' },
  { key: 'ai_research', label: 'Affordability Check', description: 'Ask whether a purchase fits your budget', minimumPlan: 'pro' },
  { key: 'cashflow_forecast', label: '30-Day Forecast', description: 'See what your money looks like in 30 days', minimumPlan: 'pro' },
  { key: 'priority_support', label: 'Priority Support', description: 'Faster help when you need it', minimumPlan: 'pro' },

  // ── Fully Autonomous — "Help me handle it" ──
  // Execution: Calico takes action and optimizes on your behalf
  { key: 'ai_automation', label: 'Task Center', description: 'Calico detects and handles routine money tasks', minimumPlan: 'autonomous' },
  { key: 'autonomous_actions', label: 'Action Approval', description: 'Review and approve actions — Calico executes', minimumPlan: 'autonomous' },
  { key: 'bill_negotiation', label: 'Bill Optimization', description: 'Identify opportunities to reduce recurring costs (coming soon)', minimumPlan: 'autonomous' },
  { key: 'advanced_forecasting', label: 'Extended Outlook', description: 'Longer-range financial projections (coming soon)', minimumPlan: 'autonomous' },
  { key: 'financial_memory', label: 'Financial Memory', description: 'Calico remembers your patterns and gets smarter over time', minimumPlan: 'autonomous' },
  { key: 'custom_integrations', label: 'Custom Integrations', description: 'Connect external services to Calico (coming soon)', minimumPlan: 'autonomous' },
  { key: 'api_access', label: 'API Access', description: 'Programmatic access to your financial data (coming soon)', minimumPlan: 'autonomous' },
  { key: 'premium_intelligence', label: 'Advanced Intelligence', description: 'Full depth of Calico analysis and optimization', minimumPlan: 'autonomous' },
];

const PLAN_HIERARCHY: PlanId[] = ['starter', 'pro', 'autonomous'];

export function canAccessFeature(userPlan: PlanId | null, feature: FeatureKey): boolean {
  if (!userPlan) return false;
  const def = FEATURES.find((f) => f.key === feature);
  if (!def) return false;
  return PLAN_HIERARCHY.indexOf(userPlan) >= PLAN_HIERARCHY.indexOf(def.minimumPlan);
}

export function getLockedFeatures(userPlan: PlanId | null): FeatureDefinition[] {
  if (!userPlan) return FEATURES;
  return FEATURES.filter(
    (f) => PLAN_HIERARCHY.indexOf(userPlan) < PLAN_HIERARCHY.indexOf(f.minimumPlan),
  );
}

export function getAvailableFeatures(userPlan: PlanId | null): FeatureDefinition[] {
  if (!userPlan) return [];
  return FEATURES.filter(
    (f) => PLAN_HIERARCHY.indexOf(userPlan) >= PLAN_HIERARCHY.indexOf(f.minimumPlan),
  );
}

export function getUpgradeTarget(userPlan: PlanId | null, feature: FeatureKey): PlanId | null {
  const def = FEATURES.find((f) => f.key === feature);
  if (!def) return null;
  if (userPlan && PLAN_HIERARCHY.indexOf(userPlan) >= PLAN_HIERARCHY.indexOf(def.minimumPlan)) {
    return null; // already has access
  }
  return def.minimumPlan;
}

// ── Plan tutorial content ───────────────────────────────────────────────────

export interface TutorialStep {
  title: string;
  body: string;
  icon: string; // lucide icon name
}

export const PLAN_TUTORIALS: Record<PlanId, { heading: string; steps: TutorialStep[] }> = {
  starter: {
    heading: "Welcome to Calico!",
    steps: [
      { title: "Your money dashboard", body: "See your accounts, net worth, and recent activity — all in one calm place.", icon: "LayoutDashboard" },
      { title: "Connect your accounts", body: "Link up to 3 bank accounts or cards. Calico only looks — never touches your money.", icon: "Link" },
      { title: "Your transaction feed", body: "Every transaction appears automatically with categories. See where your money goes.", icon: "Receipt" },
      { title: "Cash flow & budgets", body: "Track your monthly cash flow and set simple budgets to stay on track.", icon: "PiggyBank" },
    ],
  },
  pro: {
    heading: "Welcome to Calico Pro!",
    steps: [
      { title: "Everything from Starter", body: "Plus powerful tools to understand your money and decide what to do next.", icon: "Sparkles" },
      { title: "Unlimited accounts", body: "Connect as many accounts as you want — no limits.", icon: "Infinity" },
      { title: "Goals and trends", body: "Set savings targets, see spending trends over time, and track your progress.", icon: "TrendingUp" },
      { title: "AI-powered insights", body: "Calico analyzes your spending and explains what it finds — alerts, patterns, and suggestions.", icon: "CalendarCheck" },
      { title: "Recurring detection", body: "Bills and subscriptions are found automatically so nothing sneaks up on you.", icon: "RefreshCw" },
    ],
  },
  autonomous: {
    heading: "Welcome to Fully Autonomous!",
    steps: [
      { title: "Everything from Pro", body: "Plus Calico can take action on your behalf — less work for you.", icon: "Crown" },
      { title: "Task center", body: "Calico detects money tasks and presents them for your approval. Review, approve, or dismiss.", icon: "Zap" },
      { title: "Financial memory", body: "Calico remembers your patterns, preferences, and history to give smarter guidance over time.", icon: "Brain" },
      { title: "Advanced intelligence", body: "Deeper analysis across your investments and full financial picture.", icon: "Target" },
    ],
  },
};
