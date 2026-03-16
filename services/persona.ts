export interface PersonaData {
  displayName?: string;
  ageRange?: string;
  occupation?: string;
  incomeRange?: string;
  financialGoals?: string[];
  moneyStressors?: string[];
  spendingStyle?: string;
  savingStyle?: string;
  debtStatus?: string;
  investingInterest?: string;
  riskTolerance?: string;
  onboardingSummary?: string;
  rawConversation?: string;
}

export async function fetchPersonaStatus(): Promise<{ hasPersona: boolean }> {
  const res = await fetch('/api/persona', { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok || !body.ok) return { hasPersona: false };
  return { hasPersona: !!body.hasPersona };
}

export async function completePersonaOnboarding(data: PersonaData): Promise<void> {
  const res = await fetch('/api/persona/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(body.error || 'Failed to save persona');
  }
}
