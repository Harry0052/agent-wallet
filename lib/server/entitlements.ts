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
  // Starter features
  { key: 'core_dashboard', label: 'Dashboard', description: 'Your financial overview', minimumPlan: 'starter' },
  { key: 'basic_transactions', label: 'Transactions', description: 'View all transactions', minimumPlan: 'starter' },
  { key: 'basic_budgets', label: 'Basic Budgets', description: 'Simple budget setup', minimumPlan: 'starter' },
  { key: 'basic_insights', label: 'Basic Insights', description: 'Spending visibility', minimumPlan: 'starter' },
  { key: 'recurring_detection', label: 'Recurring Bills', description: 'Detect recurring charges', minimumPlan: 'starter' },
  { key: 'monthly_summaries', label: 'Monthly Summaries', description: 'Monthly spending summaries', minimumPlan: 'starter' },
  { key: 'limited_accounts', label: 'Up to 3 Accounts', description: 'Connect up to 3 accounts', minimumPlan: 'starter' },

  // Pro features
  { key: 'advanced_insights', label: 'Advanced Insights', description: 'Deeper spending analysis', minimumPlan: 'pro' },
  { key: 'spending_trends', label: 'Spending Trends', description: 'Month-over-month trend analysis', minimumPlan: 'pro' },
  { key: 'smart_savings', label: 'Smart Savings', description: 'AI-powered savings suggestions', minimumPlan: 'pro' },
  { key: 'custom_categories', label: 'Custom Categories', description: 'Create custom spending categories', minimumPlan: 'pro' },
  { key: 'unlimited_accounts', label: 'Unlimited Accounts', description: 'Connect unlimited accounts', minimumPlan: 'pro' },
  { key: 'priority_support', label: 'Priority Support', description: 'Faster response times', minimumPlan: 'pro' },
  { key: 'ai_research', label: 'AI Research', description: 'AI-powered financial research', minimumPlan: 'pro' },
  { key: 'cashflow_forecast', label: 'Cash Flow Forecast', description: '30-day cash flow prediction', minimumPlan: 'pro' },

  // Autonomous features
  { key: 'ai_automation', label: 'AI Automation', description: 'Automated financial workflows', minimumPlan: 'autonomous' },
  { key: 'autonomous_actions', label: 'Autonomous Actions', description: 'Calico acts on your behalf', minimumPlan: 'autonomous' },
  { key: 'bill_negotiation', label: 'Bill Negotiation', description: 'Automated bill negotiation', minimumPlan: 'autonomous' },
  { key: 'advanced_forecasting', label: 'Advanced Forecasting', description: 'Long-range financial forecasting', minimumPlan: 'autonomous' },
  { key: 'financial_memory', label: 'Financial Memory', description: 'Deep personalized financial memory', minimumPlan: 'autonomous' },
  { key: 'custom_integrations', label: 'Custom Integrations', description: 'Connect any financial service', minimumPlan: 'autonomous' },
  { key: 'api_access', label: 'API Access', description: 'Programmatic access to your data', minimumPlan: 'autonomous' },
  { key: 'premium_intelligence', label: 'Premium Intelligence', description: 'Most advanced money intelligence', minimumPlan: 'autonomous' },
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
    heading: "Welcome to Calico Starter",
    steps: [
      { title: "Your dashboard", body: "See your net worth, spending, and recent activity all in one calm view.", icon: "LayoutDashboard" },
      { title: "Connect accounts", body: "Link up to 3 bank accounts or credit cards. Read-only and secure.", icon: "Link" },
      { title: "Track spending", body: "Every transaction is automatically categorized so you always know where your money goes.", icon: "Receipt" },
      { title: "Spot recurring bills", body: "Calico detects subscriptions and recurring charges automatically.", icon: "RefreshCw" },
      { title: "Monthly summaries", body: "Get a clear summary of your spending at the end of each month.", icon: "CalendarCheck" },
    ],
  },
  pro: {
    heading: "Welcome to Calico Pro",
    steps: [
      { title: "Everything in Starter, plus more", body: "You get all Starter features, now with deeper intelligence.", icon: "Sparkles" },
      { title: "Unlimited accounts", body: "Connect as many accounts as you need — no limits.", icon: "Infinity" },
      { title: "Smart savings", body: "Calico identifies ways to save money based on your spending patterns.", icon: "PiggyBank" },
      { title: "Spending trends", body: "See how your spending changes month over month with trend analysis.", icon: "TrendingUp" },
      { title: "Cash flow forecast", body: "Get a 30-day prediction of your cash flow so nothing surprises you.", icon: "LineChart" },
      { title: "Priority support", body: "Get faster help when you need it.", icon: "HeadphonesIcon" },
    ],
  },
  autonomous: {
    heading: "Welcome to Calico Autonomous",
    steps: [
      { title: "The full Calico experience", body: "Everything in Pro, plus Calico's most powerful capabilities.", icon: "Crown" },
      { title: "AI automation", body: "Calico automates routine financial tasks so you don't have to think about them.", icon: "Zap" },
      { title: "Autonomous actions", body: "Calico can act on your behalf — managing bills, optimizing spending, and more.", icon: "Bot" },
      { title: "Bill negotiation", body: "Calico negotiates better rates on your bills automatically.", icon: "HeartHandshake" },
      { title: "Financial memory", body: "Calico remembers your goals, habits, and preferences — getting smarter over time.", icon: "Brain" },
      { title: "Advanced forecasting", body: "Long-range financial projections to help you plan ahead with confidence.", icon: "Target" },
      { title: "API access", body: "Build your own integrations with programmatic access to your financial data.", icon: "Code" },
    ],
  },
};
