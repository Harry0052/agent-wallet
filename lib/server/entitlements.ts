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
  // Starter — "Help me see where I stand" (intentionally minimal)
  { key: 'core_dashboard', label: 'Money Dashboard', description: 'See your whole money picture in one calm place', minimumPlan: 'starter' },
  { key: 'limited_accounts', label: 'Up to 3 Accounts', description: 'Connect up to 3 bank or card accounts', minimumPlan: 'starter' },
  { key: 'net_worth', label: 'Net Worth Tracking', description: 'Track your total net worth across all accounts', minimumPlan: 'starter' },
  { key: 'basic_transactions', label: 'Transaction Feed', description: 'See all your spending and income as it happens', minimumPlan: 'starter' },
  { key: 'spending_categories', label: 'Spending Categories', description: 'Transactions organized into clear categories automatically', minimumPlan: 'starter' },
  { key: 'monthly_cashflow', label: 'Monthly Cash Flow', description: 'See money in vs. money out each month', minimumPlan: 'starter' },
  { key: 'basic_budgets', label: 'Simple Budgets', description: 'Set up a simple monthly spending plan', minimumPlan: 'starter' },
  { key: 'monthly_summaries', label: 'Monthly Spending Summary', description: 'A clear summary of where your money went', minimumPlan: 'starter' },
  { key: 'manual_entry', label: 'Manual Entry', description: 'Add accounts and transactions by hand', minimumPlan: 'starter' },

  // Pro — "Help me understand what to do next" (the value tier)
  { key: 'unlimited_accounts', label: 'Unlimited Accounts', description: 'Connect as many accounts as you want', minimumPlan: 'pro' },
  { key: 'simple_goals', label: 'Money Goals', description: 'Set savings targets and track your progress', minimumPlan: 'pro' },
  { key: 'income_expense_chart', label: 'Income vs. Expense Chart', description: 'A clear visual of what you earn and what you spend', minimumPlan: 'pro' },
  { key: 'spending_trends', label: 'Spending Trends', description: 'See how your spending changes over time', minimumPlan: 'pro' },
  { key: 'category_breakdowns', label: 'Category Breakdowns', description: 'See exactly where your money goes by category', minimumPlan: 'pro' },
  { key: 'recurring_detection', label: 'Recurring Payment Detection', description: 'Find your bills and subscriptions automatically', minimumPlan: 'pro' },
  { key: 'basic_alerts', label: 'Smart Alerts', description: 'Get notified about important money changes and unusual spending', minimumPlan: 'pro' },
  { key: 'basic_insights', label: 'AI-Powered Summaries', description: 'AI-powered observations, tips, and analysis about your spending', minimumPlan: 'pro' },
  { key: 'advanced_insights', label: 'Deeper Insights', description: 'Deeper "why" explanations about your money', minimumPlan: 'pro' },
  { key: 'smart_savings', label: 'Savings Ideas', description: 'Calico suggests ways to save more', minimumPlan: 'pro' },
  { key: 'custom_categories', label: 'Custom Spending Groups', description: 'Organize spending your way', minimumPlan: 'pro' },
  { key: 'ai_research', label: 'Can I Afford This?', description: 'Ask Calico whether a purchase fits your budget', minimumPlan: 'pro' },
  { key: 'cashflow_forecast', label: "What's Coming", description: 'See what your money looks like in 30 days', minimumPlan: 'pro' },
  { key: 'priority_support', label: 'Priority Support', description: 'Get help faster when you need it', minimumPlan: 'pro' },

  // Fully Autonomous — "Help me handle it" (automation + execution)
  { key: 'ai_automation', label: 'Auto-Actions', description: 'Calico handles routine money tasks for you', minimumPlan: 'autonomous' },
  { key: 'autonomous_actions', label: 'Calico Acts for You', description: 'Approve actions and Calico handles the rest', minimumPlan: 'autonomous' },
  { key: 'bill_negotiation', label: 'Bill Negotiation', description: 'Calico helps negotiate lower bills', minimumPlan: 'autonomous' },
  { key: 'advanced_forecasting', label: 'Long-Range Outlook', description: 'See months ahead, not just days', minimumPlan: 'autonomous' },
  { key: 'financial_memory', label: 'Calico Remembers', description: 'Gets smarter about your habits over time', minimumPlan: 'autonomous' },
  { key: 'custom_integrations', label: 'Custom Connections', description: 'Connect any service to Calico', minimumPlan: 'autonomous' },
  { key: 'api_access', label: 'API Access', description: 'Build your own tools with your data', minimumPlan: 'autonomous' },
  { key: 'premium_intelligence', label: 'Full Money Intelligence', description: 'Calico at its smartest', minimumPlan: 'autonomous' },
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
      { title: "Everything gets smarter", body: "You have everything from Starter, plus powerful tools to understand and improve your finances.", icon: "Sparkles" },
      { title: "Unlimited accounts", body: "Connect as many accounts as you want — no limits.", icon: "Infinity" },
      { title: "Goals, trends, and insights", body: "Set money goals, see spending trends over time, and get AI-powered analysis of your habits.", icon: "TrendingUp" },
      { title: "Smart alerts", body: "Calico watches for unusual spending, bill changes, and important patterns — and lets you know.", icon: "CalendarCheck" },
      { title: "Recurring detection", body: "Calico finds your subscriptions and recurring bills automatically so nothing sneaks up on you.", icon: "RefreshCw" },
      { title: "What's Coming", body: "See what your money looks like 30 days from now so nothing surprises you.", icon: "LineChart" },
      { title: "Priority support", body: "Get faster help when you need it.", icon: "HeadphonesIcon" },
    ],
  },
  autonomous: {
    heading: "Welcome to Fully Autonomous!",
    steps: [
      { title: "Calico handles it", body: "Everything in Pro, plus Calico can actually take action on your behalf.", icon: "Crown" },
      { title: "Auto-actions", body: "Calico handles routine money tasks so you don't have to think about them.", icon: "Zap" },
      { title: "Calico acts for you", body: "Approve an action and Calico takes care of the rest — bills, savings, payments.", icon: "Bot" },
      { title: "Bill negotiation", body: "Calico helps you negotiate better rates on your bills.", icon: "HeartHandshake" },
      { title: "Calico remembers", body: "The more you use Calico, the smarter it gets about your money habits.", icon: "Brain" },
      { title: "Long-range outlook", body: "See months ahead, not just days — plan your money with confidence.", icon: "Target" },
      { title: "API access", body: "Build your own tools with programmatic access to your data.", icon: "Code" },
    ],
  },
};
