import type { ProcurementRecommendationRecord } from '@/lib/types';

export function parseProcurementRecommendation(value: Record<string, unknown> | null): ProcurementRecommendationRecord | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<ProcurementRecommendationRecord>;
  if (
    typeof raw.engineVersion !== 'string' ||
    typeof raw.generatedAt !== 'string' ||
    !Array.isArray(raw.whyWinner) ||
    !Array.isArray(raw.alternatives)
  ) {
    return null;
  }

  return raw as ProcurementRecommendationRecord;
}

export function recommendationAmount(rec: ProcurementRecommendationRecord): {
  amount: number | null;
  basis: 'monthly' | 'annual' | 'unknown';
} {
  if (rec.policy?.amountEvaluated !== null && rec.policy?.amountEvaluated !== undefined) {
    return {
      amount: rec.policy.amountEvaluated,
      basis: rec.policy.amountBasis,
    };
  }

  if (rec.winner?.monthlyPrice !== null && rec.winner?.monthlyPrice !== undefined) {
    return {
      amount: rec.winner.monthlyPrice,
      basis: 'monthly',
    };
  }

  if (rec.winner?.annualPrice !== null && rec.winner?.annualPrice !== undefined) {
    return {
      amount: rec.winner.annualPrice,
      basis: 'annual',
    };
  }

  return {
    amount: null,
    basis: 'unknown',
  };
}
