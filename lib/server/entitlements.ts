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
  // Starter — "Help me see what's going on"
  { key: 'core_dashboard', label: 'Your Dashboard', description: 'See your money at a glance', minimumPlan: 'starter' },
  { key: 'basic_transactions', label: 'Money Moves', description: 'See all your spending and income', minimumPlan: 'starter' },
  { key: 'basic_budgets', label: 'Spending Plan', description: 'Set up a simple monthly plan', minimumPlan: 'starter' },
  { key: 'basic_insights', label: 'Basic Tips', description: 'Simple spending observations', minimumPlan: 'starter' },
  { key: 'recurring_detection', label: 'Repeating Payments', description: 'Find your bills and subscriptions', minimumPlan: 'starter' },
  { key: 'monthly_summaries', label: 'Weekly & Monthly Recaps', description: 'Clear summaries of where your money went', minimumPlan: 'starter' },
  { key: 'limited_accounts', label: 'Up to 3 Accounts', description: 'Connect up to 3 bank or card accounts', minimumPlan: 'starter' },

  // Pro — "Help me understand what to do next"
  { key: 'advanced_insights', label: 'Smarter Tips', description: 'Deeper "why" explanations about your money', minimumPlan: 'pro' },
  { key: 'spending_trends', label: 'Spending Trends', description: 'See how your spending changes over time', minimumPlan: 'pro' },
  { key: 'smart_savings', label: 'Savings Ideas', description: 'Calico suggests ways to save more', minimumPlan: 'pro' },
  { key: 'custom_categories', label: 'Custom Spending Groups', description: 'Organize spending your way', minimumPlan: 'pro' },
  { key: 'unlimited_accounts', label: 'Unlimited Accounts', description: 'Connect as many accounts as you want', minimumPlan: 'pro' },
  { key: 'priority_support', label: 'Priority Support', description: 'Get help faster when you need it', minimumPlan: 'pro' },
  { key: 'ai_research', label: 'Ask Calico More', description: 'Deeper answers and analysis from Calico', minimumPlan: 'pro' },
  { key: 'cashflow_forecast', label: "What's Coming", description: 'See what your money looks like in 30 days', minimumPlan: 'pro' },

  // Fully Autonomous — "Help me handle it"
  { key: 'ai_automation', label: 'Auto-Actions', description: 'Calico handles routine money tasks for you', minimumPlan: 'autonomous' },
  { key: 'autonomous_actions', label: 'Calico Acts for You', description: 'Approve actions and Calico handles the rest', minimumPlan: 'autonomous' },
  { key: 'bill_negotiation', label: 'Bill Help', description: 'Calico helps negotiate lower bills', minimumPlan: 'autonomous' },
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
      { title: "Your dashboard", body: "See your total money, spending, and recent activity in one calm place.", icon: "LayoutDashboard" },
      { title: "Connect your accounts", body: "Link up to 3 bank accounts or cards. Calico only looks — never touches your money.", icon: "Link" },
      { title: "See your money moves", body: "Every purchase and payment is organized automatically so you always know where your money goes.", icon: "Receipt" },
      { title: "Find repeating payments", body: "Calico finds your bills and subscriptions so nothing sneaks up on you.", icon: "RefreshCw" },
      { title: "Get weekly recaps", body: "A simple summary of where your money went — every week and every month.", icon: "CalendarCheck" },
    ],
  },
  pro: {
    heading: "Welcome to Calico Pro!",
    steps: [
      { title: "Everything gets smarter", body: "You still have everything from Starter, but now Calico understands your money better.", icon: "Sparkles" },
      { title: "Unlimited accounts", body: "Connect as many accounts as you want — no limits.", icon: "Infinity" },
      { title: "Savings ideas", body: "Calico spots ways you could save money based on your spending.", icon: "PiggyBank" },
      { title: "Spending trends", body: "See how your spending changes month to month, and find out why.", icon: "TrendingUp" },
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
      { title: "Bill help", body: "Calico helps you negotiate better rates on your bills.", icon: "HeartHandshake" },
      { title: "Calico remembers", body: "The more you use Calico, the smarter it gets about your money habits.", icon: "Brain" },
      { title: "Long-range outlook", body: "See months ahead, not just days — plan your money with confidence.", icon: "Target" },
      { title: "API access", body: "Build your own tools with programmatic access to your data.", icon: "Code" },
    ],
  },
};
