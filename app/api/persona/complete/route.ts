import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { upsertUserPersona, addMemoryEntry } from '@/lib/server/persona';
import { completeOnboarding } from '@/lib/server/onboarding';
import { apiError, logServerEvent } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CompleteSchema = z.object({
  displayName: z.string().optional(),
  ageRange: z.string().optional(),
  occupation: z.string().optional(),
  incomeRange: z.string().optional(),
  financialGoals: z.array(z.string()).optional(),
  moneyStressors: z.array(z.string()).optional(),
  spendingStyle: z.string().optional(),
  savingStyle: z.string().optional(),
  debtStatus: z.string().optional(),
  investingInterest: z.string().optional(),
  riskTolerance: z.string().optional(),
  onboardingSummary: z.string().optional(),
  rawConversation: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'persona' });
  if (rateLimited) return rateLimited;

  try {
    const user = await requireAuthenticatedUser();
    const body = await req.json();
    const parsed = CompleteSchema.parse(body);

    const persona = await upsertUserPersona({
      userId: user.appUserId,
      ...parsed,
      onboardingCompleted: true,
    });

    // Also mark the legacy onboarding as complete
    await completeOnboarding({
      appUserId: user.appUserId,
      skippedToolSetup: true,
      preferencesPatch: { onboardingCompletedFrom: 'persona_chat' },
    });

    // Store key traits in financial memory
    const memoryEntries: { category: string; content: string }[] = [];

    if (parsed.displayName) {
      memoryEntries.push({ category: 'identity', content: `User's name is ${parsed.displayName}` });
    }
    if (parsed.occupation) {
      memoryEntries.push({ category: 'identity', content: `User is a ${parsed.occupation}` });
    }
    if (parsed.financialGoals?.length) {
      memoryEntries.push({ category: 'goals', content: `Financial goals: ${parsed.financialGoals.join(', ')}` });
    }
    if (parsed.moneyStressors?.length) {
      memoryEntries.push({ category: 'stress', content: `Money stressors: ${parsed.moneyStressors.join(', ')}` });
    }
    if (parsed.riskTolerance) {
      memoryEntries.push({ category: 'preference', content: `Risk tolerance: ${parsed.riskTolerance}` });
    }
    if (parsed.investingInterest) {
      memoryEntries.push({ category: 'interest', content: `Investing interest: ${parsed.investingInterest}` });
    }
    if (parsed.onboardingSummary) {
      memoryEntries.push({ category: 'summary', content: parsed.onboardingSummary });
    }

    await Promise.all(
      memoryEntries.map((entry) =>
        addMemoryEntry({
          userId: user.appUserId,
          category: entry.category,
          content: entry.content,
          source: 'onboarding',
        }),
      ),
    );

    logServerEvent('info', 'persona.onboarding.completed', { userId: user.appUserId });

    return NextResponse.json({ ok: true, persona });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete persona';
    logServerEvent('error', 'persona.complete.failed', { error: message });

    if (message.includes('Authentication required')) {
      return NextResponse.json(apiError('VALIDATION_ERROR', message, false), { status: 401 });
    }
    return NextResponse.json(apiError('UNKNOWN_FAILURE', message, true), { status: 500 });
  }
}
