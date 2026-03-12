import "server-only";

import type { DetectedSubscription } from "@/subscription_intelligence/subscriptionService";
import type { NormalizedSpendTransaction } from "@/ai_spend_intelligence/spendAnalyzer";

export interface UnusedSubscriptionSuggestion {
  unused_subscription: string;
  monthly_cost: number;
  last_used: string;
  recommendation: "consider canceling";
  confidence: number;
  reason: string;
}

export interface CancellationSuggestion {
  subscription: string;
  monthly_cost: number;
  recommendation: "consider canceling" | "review usage";
  confidence: number;
  reason: string;
  last_seen: string;
}

export interface SubscriptionAdvisorResult {
  unused_subscriptions: UnusedSubscriptionSuggestion[];
  cancellation_suggestions: CancellationSuggestion[];
}

function merchantKey(value: string): string {
  return value.trim().toLowerCase();
}

function daysSince(dateIso: string, now: Date): number {
  const parsed = Date.parse(dateIso);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - parsed) / (1000 * 60 * 60 * 24);
}

function findLastUsedTransaction(
  subscription: DetectedSubscription,
  transactions: NormalizedSpendTransaction[],
): string | null {
  const target = merchantKey(subscription.merchant);
  const matches = transactions
    .filter((tx) => {
      const normalized = merchantKey(tx.merchant_group || tx.merchant);
      return normalized === target || normalized.includes(target) || target.includes(normalized);
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return matches[0]?.date || null;
}

export function suggestUnusedSubscriptions(input: {
  subscriptions: DetectedSubscription[];
  transactions: NormalizedSpendTransaction[];
  now?: Date;
}): UnusedSubscriptionSuggestion[] {
  const now = input.now || new Date();

  return input.subscriptions
    .map((subscription) => {
      const lastUsed = findLastUsedTransaction(subscription, input.transactions);
      const days = lastUsed ? daysSince(lastUsed, now) : Number.POSITIVE_INFINITY;
      if (days < 60) return null;

      return {
        unused_subscription: subscription.merchant,
        monthly_cost: subscription.estimated_monthly_cost,
        last_used: lastUsed || "unknown",
        recommendation: "consider canceling" as const,
        confidence: Number(Math.max(0.55, subscription.confidence).toFixed(2)),
        reason:
          lastUsed
            ? `No recent activity in the last ${Math.floor(days)} days.`
            : "No clear recent usage signal for this subscription.",
      };
    })
    .filter((item): item is UnusedSubscriptionSuggestion => item !== null)
    .sort((a, b) => b.monthly_cost - a.monthly_cost);
}

export function suggestCancellationCandidates(input: {
  subscriptions: DetectedSubscription[];
  transactions: NormalizedSpendTransaction[];
  now?: Date;
}): CancellationSuggestion[] {
  const now = input.now || new Date();

  return input.subscriptions
    .map((subscription) => {
      const lastSeen = findLastUsedTransaction(subscription, input.transactions) || subscription.last_seen;
      const days = daysSince(lastSeen, now);
      const expensive = subscription.estimated_monthly_cost >= 20;
      const stale = days >= 45;
      const confidenceHigh = subscription.confidence >= 0.75;

      if (!confidenceHigh || (!expensive && !stale)) {
        return null;
      }

      const recommendation = stale || expensive ? "consider canceling" : "review usage";

      return {
        subscription: subscription.merchant,
        monthly_cost: subscription.estimated_monthly_cost,
        recommendation,
        confidence: Number(subscription.confidence.toFixed(2)),
        reason: stale
          ? `Recurring charge appears stale (${Math.floor(days)} days since last seen).`
          : "Monthly subscription cost is high relative to likely utility.",
        last_seen: lastSeen,
      };
    })
    .filter((item): item is CancellationSuggestion => item !== null)
    .sort((a, b) => {
      if (b.monthly_cost !== a.monthly_cost) return b.monthly_cost - a.monthly_cost;
      return b.confidence - a.confidence;
    });
}

export function adviseOnSubscriptions(input: {
  subscriptions: DetectedSubscription[];
  transactions: NormalizedSpendTransaction[];
  now?: Date;
}): SubscriptionAdvisorResult {
  return {
    unused_subscriptions: suggestUnusedSubscriptions(input),
    cancellation_suggestions: suggestCancellationCandidates(input),
  };
}
