import type { Wallet } from '@/lib/types';

export interface ReasoningPlan {
  intent: 'buy' | 'clarify' | 'other';
  summary: string;
  normalizedRequest: string;
  searchQuery: string;
  budgetMax: number;
  needsClarification: boolean;
  clarifyingQuestion?: string;
  plan: string[];
  guardrailChecks: string[];
}

export async function buildReasoningPlan(userMessage: string, wallet: Wallet): Promise<ReasoningPlan> {
  const res = await fetch('/api/reason', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userMessage,
      wallet: {
        balance: wallet.balance,
        settings: wallet.settings,
      },
    }),
  });

  const body = (await res.json()) as { reasoning?: ReasoningPlan; error?: string };
  if (!res.ok) {
    throw new Error(body.error || 'Failed to generate reasoning plan');
  }
  if (!body.reasoning) {
    throw new Error('Reasoning plan missing from API response');
  }

  return body.reasoning;
}
