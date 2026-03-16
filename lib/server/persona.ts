import 'server-only';

import { query } from '@/lib/server/db';

export interface UserPersona {
  userId: string;
  displayName: string | null;
  ageRange: string | null;
  occupation: string | null;
  incomeRange: string | null;
  financialGoals: string[];
  moneyStressors: string[];
  spendingStyle: string | null;
  savingStyle: string | null;
  debtStatus: string | null;
  investingInterest: string | null;
  riskTolerance: string | null;
  onboardingSummary: string | null;
  rawConversation: string | null;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PersonaRow {
  user_id: string;
  display_name: string | null;
  age_range: string | null;
  occupation: string | null;
  income_range: string | null;
  financial_goals: unknown;
  money_stressors: unknown;
  spending_style: string | null;
  saving_style: string | null;
  debt_status: string | null;
  investing_interest: string | null;
  risk_tolerance: string | null;
  onboarding_summary: string | null;
  raw_conversation: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  return [];
}

function rowToPersona(row: PersonaRow): UserPersona {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    ageRange: row.age_range,
    occupation: row.occupation,
    incomeRange: row.income_range,
    financialGoals: toStringArray(row.financial_goals),
    moneyStressors: toStringArray(row.money_stressors),
    spendingStyle: row.spending_style,
    savingStyle: row.saving_style,
    debtStatus: row.debt_status,
    investingInterest: row.investing_interest,
    riskTolerance: row.risk_tolerance,
    onboardingSummary: row.onboarding_summary,
    rawConversation: row.raw_conversation,
    onboardingCompleted: row.onboarding_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserPersona(userId: string): Promise<UserPersona | null> {
  const result = await query<PersonaRow>(
    `SELECT user_id, display_name, age_range, occupation, income_range,
            financial_goals, money_stressors, spending_style, saving_style,
            debt_status, investing_interest, risk_tolerance,
            onboarding_summary, raw_conversation, onboarding_completed,
            created_at::text, updated_at::text
     FROM user_personas WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (!result.rows[0]) return null;
  return rowToPersona(result.rows[0]);
}

export async function upsertUserPersona(params: {
  userId: string;
  displayName?: string | null;
  ageRange?: string | null;
  occupation?: string | null;
  incomeRange?: string | null;
  financialGoals?: string[];
  moneyStressors?: string[];
  spendingStyle?: string | null;
  savingStyle?: string | null;
  debtStatus?: string | null;
  investingInterest?: string | null;
  riskTolerance?: string | null;
  onboardingSummary?: string | null;
  rawConversation?: string | null;
  onboardingCompleted?: boolean;
}): Promise<UserPersona> {
  await query(
    `INSERT INTO user_personas (
       user_id, display_name, age_range, occupation, income_range,
       financial_goals, money_stressors, spending_style, saving_style,
       debt_status, investing_interest, risk_tolerance,
       onboarding_summary, raw_conversation, onboarding_completed
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (user_id)
     DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, user_personas.display_name),
       age_range = COALESCE(EXCLUDED.age_range, user_personas.age_range),
       occupation = COALESCE(EXCLUDED.occupation, user_personas.occupation),
       income_range = COALESCE(EXCLUDED.income_range, user_personas.income_range),
       financial_goals = CASE WHEN EXCLUDED.financial_goals IS NOT NULL THEN EXCLUDED.financial_goals ELSE user_personas.financial_goals END,
       money_stressors = CASE WHEN EXCLUDED.money_stressors IS NOT NULL THEN EXCLUDED.money_stressors ELSE user_personas.money_stressors END,
       spending_style = COALESCE(EXCLUDED.spending_style, user_personas.spending_style),
       saving_style = COALESCE(EXCLUDED.saving_style, user_personas.saving_style),
       debt_status = COALESCE(EXCLUDED.debt_status, user_personas.debt_status),
       investing_interest = COALESCE(EXCLUDED.investing_interest, user_personas.investing_interest),
       risk_tolerance = COALESCE(EXCLUDED.risk_tolerance, user_personas.risk_tolerance),
       onboarding_summary = COALESCE(EXCLUDED.onboarding_summary, user_personas.onboarding_summary),
       raw_conversation = COALESCE(EXCLUDED.raw_conversation, user_personas.raw_conversation),
       onboarding_completed = COALESCE(EXCLUDED.onboarding_completed, user_personas.onboarding_completed),
       updated_at = NOW()`,
    [
      params.userId,
      params.displayName ?? null,
      params.ageRange ?? null,
      params.occupation ?? null,
      params.incomeRange ?? null,
      params.financialGoals ? JSON.stringify(params.financialGoals) : null,
      params.moneyStressors ? JSON.stringify(params.moneyStressors) : null,
      params.spendingStyle ?? null,
      params.savingStyle ?? null,
      params.debtStatus ?? null,
      params.investingInterest ?? null,
      params.riskTolerance ?? null,
      params.onboardingSummary ?? null,
      params.rawConversation ?? null,
      params.onboardingCompleted ?? false,
    ],
  );

  const persona = await getUserPersona(params.userId);
  return persona!;
}

export async function isPersonaOnboardingComplete(userId: string): Promise<boolean> {
  const result = await query<{ onboarding_completed: boolean }>(
    `SELECT onboarding_completed FROM user_personas WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.onboarding_completed ?? false;
}

// ── Financial Memory Foundation ─────────────────────────────────

export interface MemoryEntry {
  id: string;
  userId: string;
  category: string;
  content: string;
  source: string;
  createdAt: string;
}

export async function addMemoryEntry(params: {
  userId: string;
  category: string;
  content: string;
  source: string;
}): Promise<void> {
  const { randomUUID } = await import('node:crypto');
  await query(
    `INSERT INTO user_financial_memory (id, user_id, category, content, source)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), params.userId, params.category, params.content, params.source],
  );
}

export async function getMemoryEntries(userId: string, limit = 50): Promise<MemoryEntry[]> {
  const result = await query<{
    id: string;
    user_id: string;
    category: string;
    content: string;
    source: string;
    created_at: string;
  }>(
    `SELECT id, user_id, category, content, source, created_at::text
     FROM user_financial_memory
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    category: r.category,
    content: r.content,
    source: r.source,
    createdAt: r.created_at,
  }));
}
