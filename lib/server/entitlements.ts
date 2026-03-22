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
  // ── Starter — "Your first money system" ──
  // First structure: see your money, get a first plan, know what to do next
  { key: 'core_dashboard', label: 'Money Dashboard', description: 'Your full money picture in one place', minimumPlan: 'starter' },
  { key: 'limited_accounts', label: 'Up to 3 Accounts', description: 'Connect up to 3 bank or card accounts', minimumPlan: 'starter' },
  { key: 'net_worth', label: 'Net Worth', description: 'See your total balance across all accounts', minimumPlan: 'starter' },
  { key: 'basic_transactions', label: 'Transaction Feed', description: 'See spending and income as it happens', minimumPlan: 'starter' },
  { key: 'spending_categories', label: 'Auto-Categories', description: 'Transactions sorted into categories automatically', minimumPlan: 'starter' },
  { key: 'monthly_cashflow', label: 'Cash Flow', description: 'Monthly money in vs. money out', minimumPlan: 'starter' },
  { key: 'basic_budgets', label: 'First Budget Draft', description: 'Calico builds your first spending plan from your history', minimumPlan: 'starter' },
  { key: 'monthly_summaries', label: 'Weekly Safe to Spend', description: 'Know how much you can comfortably spend each week', minimumPlan: 'starter' },
  { key: 'manual_entry', label: 'Manual Entry', description: 'Add accounts and transactions by hand', minimumPlan: 'starter' },

  // ── Pro — "Your adaptive money coach" ──
  // Coaching: personalized guidance, smart plans, purchase planning, credit, investing readiness
  { key: 'unlimited_accounts', label: 'Unlimited Accounts', description: 'Connect all your banks, cards, and loans', minimumPlan: 'pro' },
  { key: 'simple_goals', label: 'Money Goals', description: 'Goals with suggested targets, timelines, and contribution amounts', minimumPlan: 'pro' },
  { key: 'income_expense_chart', label: 'Income vs. Spending', description: 'See what you earn and spend side by side', minimumPlan: 'pro' },
  { key: 'spending_trends', label: 'Spending Trends', description: 'Track how your spending changes month to month', minimumPlan: 'pro' },
  { key: 'category_breakdowns', label: 'Category Breakdown', description: 'See exactly where your money goes by category', minimumPlan: 'pro' },
  { key: 'recurring_detection', label: 'Bill & Income Detection', description: 'Bills and income sources found and tracked automatically', minimumPlan: 'pro' },
  { key: 'basic_alerts', label: 'Smart Alerts', description: 'Get notified about unusual spending or important changes', minimumPlan: 'pro' },
  { key: 'basic_insights', label: 'Coaching Insights', description: 'Personalized guidance based on your life stage and habits', minimumPlan: 'pro' },
  { key: 'advanced_insights', label: 'Deep Analysis', description: 'Pattern explanations and spending comparisons over time', minimumPlan: 'pro' },
  { key: 'smart_savings', label: 'Savings Coaching', description: 'Calico finds realistic ways you could save more', minimumPlan: 'pro' },
  { key: 'custom_categories', label: 'Custom Categories', description: 'Organize transactions into your own groups', minimumPlan: 'pro' },
  { key: 'ai_research', label: 'Purchase Planner', description: 'Ask Calico if you can afford something and when to buy it', minimumPlan: 'pro' },
  { key: 'cashflow_forecast', label: '30-Day Forecast', description: 'See where your money will be in 30 days', minimumPlan: 'pro' },
  { key: 'priority_support', label: 'Priority Support', description: 'Faster help when you need it', minimumPlan: 'pro' },

  // ── Fully Autonomous — "Help me handle it" ──
  // Execution: Calico takes action and optimizes on your behalf
  { key: 'ai_automation', label: 'Action Center', description: 'Calico detects issues, drafts fixes, and asks for your approval', minimumPlan: 'autonomous' },
  { key: 'autonomous_actions', label: 'Learned Rules', description: 'Calico remembers corrections and applies them automatically', minimumPlan: 'autonomous' },
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
    heading: "Your first money system",
    steps: [
      { title: "See everything in one place", body: "Your accounts, balances, and net worth — all together. This is your financial home base.", icon: "LayoutDashboard" },
      { title: "Link your accounts", body: "Connect up to 3 bank accounts or cards. Calico only looks — never touches your money.", icon: "Link" },
      { title: "Know what's safe to spend", body: "Each week, Calico tells you how much is safe to spend after bills and essentials.", icon: "Sparkles" },
      { title: "Your first budget and goal", body: "Calico drafts a simple spending plan and suggests your first savings goal. Just review and adjust.", icon: "PiggyBank" },
    ],
  },
  pro: {
    heading: "Your adaptive money coach",
    steps: [
      { title: "Guidance built for your life", body: "Pro adapts to your age, income, goals, and habits. The advice gets more relevant over time.", icon: "Sparkles" },
      { title: "Smart spending plan", body: "Calico builds your budget from your real spending and adjusts it as things change.", icon: "PiggyBank" },
      { title: "Goals with real timelines", body: "Set savings targets and Calico suggests how much to save each month and when you'll reach them.", icon: "Target" },
      { title: "Purchase planner", body: "Before a big spend, ask Calico if you can afford it — and when the best time to buy would be.", icon: "CalendarCheck" },
      { title: "Credit and investing guidance", body: "Calico helps you build credit and tells you when you're ready to start investing — no jargon.", icon: "TrendingUp" },
      { title: "Insights and cleanup", body: "Calico spots patterns, recommends actions, and helps you keep your transaction data clean.", icon: "Receipt" },
    ],
  },
  autonomous: {
    heading: "Calico handles the work",
    steps: [
      { title: "Less manual work", body: "Everything in Pro, plus Calico detects routine money tasks and prepares them for your approval.", icon: "Crown" },
      { title: "Action Center", body: "Transfer cleanup, recurring confirmations, budget drafts, category fixes — all in one place. Approve or dismiss with one tap.", icon: "Zap" },
      { title: "Calico learns from you", body: "Every correction you make teaches Calico. Over time, it handles more automatically and gets smarter.", icon: "Brain" },
    ],
  },
};
