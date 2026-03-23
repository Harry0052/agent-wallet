import 'server-only';

import type { PlanId } from '@/lib/server/billing';
import type { SmartHomePayload } from '@/lib/server/smartHome';

// ── Types ───────────────────────────────────────────────────────────────────

export type InsightType = 'warning' | 'opportunity' | 'prediction';

export interface ActionableInsight {
  type: InsightType;
  title: string;
  description: string;
  impactLabel: string;
  cta: string | null;
}

export interface LockedInsightPreview {
  teaser: string;
}

export interface ActionableInsightsResult {
  primary: ActionableInsight | null;
  additional: ActionableInsight[];
  locked: LockedInsightPreview[];
}

// ── Plan gating ─────────────────────────────────────────────────────────────

const PLAN_HIERARCHY: PlanId[] = ['starter', 'pro', 'autonomous'];

function planLevel(plan: PlanId | null): number {
  if (!plan) return -1;
  return PLAN_HIERARCHY.indexOf(plan);
}

// ── Insight generation (deterministic heuristics) ───────────────────────────

interface CandidateInsight extends ActionableInsight {
  priority: number; // higher = better
}

function generateCandidates(payload: SmartHomePayload): CandidateInsight[] {
  const candidates: CandidateInsight[] = [];
  const cf = payload.cashFlow;

  // ① Subscription waste / recurring charges
  const foundMoneyCard = payload.insightCards.find((c) => c.id === 'found_money');
  if (foundMoneyCard) {
    const monthlyMatch = foundMoneyCard.summary.match(/\$([0-9,.]+)/);
    const monthlySavings = monthlyMatch ? parseFloat(monthlyMatch[1].replace(',', '')) : 0;

    if (monthlySavings > 0) {
      candidates.push({
        type: 'opportunity',
        title: `You could save ~$${Math.round(monthlySavings)}/month`,
        description: `We found recurring charges that may be worth reviewing or canceling.`,
        impactLabel: `~$${Math.round(monthlySavings * 12)}/year potential savings`,
        cta: 'Review recurring spend',
        priority: 90 + Math.min(monthlySavings, 100),
      });
    }
  }

  // ② Overspending anomaly
  const anomalyCard = payload.insightCards.find((c) => c.id === 'unusual_spending');
  if (anomalyCard) {
    const chargeMatch = anomalyCard.summary.match(/(\d+)\s+unusual/);
    const chargeCount = chargeMatch ? parseInt(chargeMatch[1], 10) : 0;

    if (chargeCount > 0) {
      candidates.push({
        type: 'warning',
        title: `${chargeCount} unusual charge${chargeCount === 1 ? '' : 's'} detected`,
        description: `Spending patterns that look different from your norm were flagged for review.`,
        impactLabel: `${chargeCount} item${chargeCount === 1 ? '' : 's'} to review`,
        cta: 'Inspect charges',
        priority: 80 + chargeCount * 5,
      });
    }
  }

  // ③ Cash depletion / runway prediction
  if (cf && cf.daysUntilNegative !== null && cf.daysUntilNegative > 0 && cf.daysUntilNegative <= 30) {
    candidates.push({
      type: 'prediction',
      title: `Balance may drop below $0 in ${cf.daysUntilNegative} days`,
      description: `At your current spending pace, your available cash could run out soon.`,
      impactLabel: `${cf.daysUntilNegative} day${cf.daysUntilNegative === 1 ? '' : 's'} of runway`,
      cta: 'View cash flow',
      priority: 100 + (30 - cf.daysUntilNegative) * 3, // more urgent = higher priority
    });
  }

  // ④ Savings opportunity from safe-to-spend surplus
  if (cf && cf.safeToSpendThisMonth > 200) {
    const surplus = Math.round(cf.safeToSpendThisMonth * 0.3);
    if (surplus > 20) {
      candidates.push({
        type: 'opportunity',
        title: `You could save ~$${surplus} this month`,
        description: `Based on your safe-to-spend calculation, there's room to set aside more.`,
        impactLabel: `~$${surplus * 12}/year if consistent`,
        cta: 'Set a savings goal',
        priority: 50 + Math.min(surplus, 50),
      });
    }
  }

  // ⑤ Budget risk from 30-day outlook
  if (payload.summary.outlook30dDelta < -100) {
    const deficit = Math.abs(Math.round(payload.summary.outlook30dDelta));
    candidates.push({
      type: 'warning',
      title: `Projected $${deficit} shortfall this month`,
      description: `Your 30-day cash projection shows expenses may exceed income.`,
      impactLabel: `-$${deficit} projected`,
      cta: 'Review spending plan',
      priority: 70 + Math.min(deficit / 10, 30),
    });
  }

  // ⑥ Recurring bill count summary (lower priority, good fallback)
  const recurringCard = payload.insightCards.find((c) => c.id === 'recurring_bills');
  if (recurringCard) {
    const countMatch = recurringCard.summary.match(/(\d+)\s+recurring/);
    const amountMatch = recurringCard.summary.match(/\$([0-9,.]+)\/month/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;
    const monthlyTotal = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;

    if (count >= 2 && monthlyTotal > 0) {
      candidates.push({
        type: 'opportunity',
        title: `${count} recurring charges costing ~$${Math.round(monthlyTotal)}/month`,
        description: `We're tracking your subscriptions and bills. Worth a quick check.`,
        impactLabel: `$${Math.round(monthlyTotal)}/month in recurring`,
        cta: 'Review bills',
        priority: 40 + count * 2,
      });
    }
  }

  return candidates;
}

function fallbackInsight(
  dataQuality?: { mode: string; lowData: boolean },
): ActionableInsight {
  // State 1: No connected accounts
  if (!dataQuality || dataQuality.mode === 'no_connected_accounts') {
    return {
      type: 'opportunity',
      title: 'Connect an account to unlock insights',
      description: 'Calico analyzes your spending to surface savings opportunities and warnings.',
      impactLabel: 'Personalized insights await',
      cta: 'Get started',
    };
  }

  // State 2: Accounts connected but transactions haven't synced yet
  if (dataQuality.mode === 'awaiting_sync') {
    return {
      type: 'opportunity',
      title: 'We\'re analyzing your transactions',
      description: 'Your accounts are connected. Insights will appear once your transaction data finishes syncing.',
      impactLabel: 'Syncing in progress',
      cta: null,
    };
  }

  // State 3: Accounts connected, thin history — not enough patterns yet
  if (dataQuality.mode === 'thin_history') {
    return {
      type: 'opportunity',
      title: 'Building your financial picture',
      description: 'Calico is learning your spending patterns. More insights will appear as your transaction history grows.',
      impactLabel: 'Analyzing your data',
      cta: 'View cash flow',
    };
  }

  // State 4: Full data, but no specific insights triggered (everything looks normal)
  return {
    type: 'opportunity',
    title: 'Your finances look steady',
    description: 'No unusual spending or savings opportunities detected right now. Calico will notify you when something comes up.',
    impactLabel: 'All clear',
    cta: null,
  };
}

// ── Locked preview teasers (generic, no real data) ──────────────────────────

const LOCKED_TEASERS: LockedInsightPreview[] = [
  { teaser: 'A savings opportunity was found' },
  { teaser: 'A spending pattern worth reviewing' },
  { teaser: 'A future cash-flow alert is available' },
];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate plan-gated actionable insights from an already-computed SmartHomePayload.
 *
 * - All plans: 1 primary insight (the most impactful)
 * - Pro+: up to 2 additional real insights
 * - Starter: locked preview placeholders only (no real data leaked)
 */
export function generateActionableInsights(
  payload: SmartHomePayload,
  plan: PlanId | null,
): ActionableInsightsResult {
  const candidates = generateCandidates(payload);
  const sorted = candidates.sort((a, b) => b.priority - a.priority);

  // Strip internal priority field
  const clean = (c: CandidateInsight): ActionableInsight => ({
    type: c.type,
    title: c.title,
    description: c.description,
    impactLabel: c.impactLabel,
    cta: c.cta,
  });

  // Primary insight: best candidate or state-aware fallback
  const primary = sorted.length > 0
    ? clean(sorted[0])
    : fallbackInsight(payload.dataQuality);

  // Additional insights: plan-gated
  const isPro = planLevel(plan) >= planLevel('pro');

  if (isPro && sorted.length > 1) {
    // Pro+ users: return up to 2 real additional insights
    const additional = sorted.slice(1, 3).map(clean);
    return { primary, additional, locked: [] };
  }

  // Starter / no plan: return locked placeholders, never real data
  return {
    primary,
    additional: [],
    locked: LOCKED_TEASERS.slice(0, 2),
  };
}
