import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { classifyRequest, type ClassifiedRequestType } from '@/lib/ai/classifier';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { sanitizeAiText } from '@/security/aiSanitizer';
import { PromptInjectionError, assertPromptSafe } from '@/security/promptGuard';
import { runInAiExecutionContext } from '@/security/secretsGuard';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

const BodySchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required'),
  // sourceButton: should be "general" when called from the General panel.
  // Accepted for logging and routing transparency. TinyFish is never used here.
  sourceButton: z.enum(['research', 'general', 'task']).optional(),
});

type SectionRoute = {
  label: string;
  href: string;
  description: string;
  keywords: string[];
};

type SuggestedRoute = {
  label: string;
  href: string;
  description: string;
};

const APP_SECTIONS: SectionRoute[] = [
  {
    label: 'Dashboard',
    href: '/operator',
    description: 'Main workspace for chat and task workflows.',
    keywords: ['dashboard', 'home', 'operator', 'workspace', 'main'],
  },
  {
    label: 'Wallet',
    href: '/wallet',
    description: 'Balance, funding methods, recipients, and wallet controls.',
    keywords: ['wallet', 'balance', 'fund', 'funding', 'card', 'bank', 'recipient', 'send'],
  },
  {
    label: 'Execution',
    href: '/execution',
    description: 'Track active runs and task progress in real time.',
    keywords: ['execution', 'run', 'status', 'task status', 'progress', 'activity'],
  },
  {
    label: 'Subscriptions',
    href: '/subscriptions',
    description: 'Review, manage, and cancel subscription operations.',
    keywords: ['subscription', 'subscriptions', 'billing', 'renewal', 'cancel'],
  },
  {
    label: 'Settings',
    href: '/settings',
    description: 'Update account preferences, profile, and controls.',
    keywords: ['settings', 'preferences', 'profile', 'account', 'password', 'security'],
  },
  {
    label: 'Tools',
    href: '/tools',
    description: 'Manage connected tools and integration credentials.',
    keywords: ['tool', 'tools', 'integration', 'connect', 'connected', 'credential', 'login'],
  },
  {
    label: 'Statements',
    href: '/statements',
    description: 'View transaction history and statement details.',
    keywords: ['statement', 'statements', 'history', 'transaction', 'transactions', 'ledger'],
  },
];

function includesPhrase(input: string, phrase: string): boolean {
  return input.includes(phrase.toLowerCase());
}

function rankSuggestedRoutes(prompt: string): SuggestedRoute[] {
  const normalized = prompt.toLowerCase();

  const scored = APP_SECTIONS
    .map((section) => {
      const score = section.keywords.reduce((total, keyword) => (
        includesPhrase(normalized, keyword) ? total + 1 : total
      ), 0);

      return {
        section,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const matched = scored.filter((entry) => entry.score > 0).slice(0, 3);
  if (matched.length > 0) {
    return matched.map(({ section }) => ({
      label: section.label,
      href: section.href,
      description: section.description,
    }));
  }

  return APP_SECTIONS
    .filter((section) => (
      section.href === '/operator'
      || section.href === '/wallet'
      || section.href === '/settings'
    ))
    .map((section) => ({
      label: section.label,
      href: section.href,
      description: section.description,
    }));
}

function buildGeneralAnswer(prompt: string, requestType: ClassifiedRequestType): string {
  const normalized = prompt.toLowerCase();

  if (requestType === 'task') {
    return 'This sounds like an action request. Use the Tasks panel to run the action, then monitor progress in Execution.';
  }

  if (requestType === 'research') {
    return 'This looks like a research question. Use the Research panel for comparisons and recommendations, then return here for account or navigation help.';
  }

  if (/(connect|link|add).*(card|bank|account)|(card|bank|account).*(connect|link|add)/i.test(normalized)) {
    return 'To connect a card or bank account, open Wallet and follow the funding setup flow.';
  }

  if (/(transaction|history|statement|ledger)/i.test(normalized)) {
    return 'For past activity and records, open Statements. You can also use Wallet for balance and recent movement.';
  }

  if (/(subscription|cancel|renew|billing)/i.test(normalized)) {
    return 'For billing and subscription changes, open Subscriptions. You can review active plans and run cancellation workflows there.';
  }

  if (/(setting|profile|password|security|account)/i.test(normalized)) {
    return 'For account changes, open Settings. That section has profile and control options.';
  }

  if (/(task|run|execution|status|progress)/i.test(normalized)) {
    return 'To check task progress, open Execution for live run status and updates.';
  }

  return 'I can help with navigation and product questions. Tell me what you are trying to do, and I will point you to the right section.';
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'ai', scope: 'ai_general_chat' });
  if (rateLimited) return rateLimited;

  try {
    return await runInAiExecutionContext(async () => {
      const { prompt, sourceButton } = BodySchema.parse(await req.json());
      assertPromptSafe(prompt, 'api.ai.general-chat.prompt');
      const safePrompt = sanitizeAiText(prompt);

      const classifiedRequestType = classifyRequest(safePrompt);

      // Log routing metadata for observability. TinyFish is unconditionally
      // forbidden in the general pipeline — no browser automation ever runs here.
      logServerEvent('info', 'ai.general_chat.routing', {
        sourceButton: sourceButton ?? 'unset',
        classifiedRequestType,
        tinyfishBlocked: true,
      });

      const answer = buildGeneralAnswer(safePrompt, classifiedRequestType);
      const suggestedRoutes = rankSuggestedRoutes(safePrompt);

      return NextResponse.json({
        ok: true,
        answer,
        classifiedRequestType,
        suggestedRoutes,
      });
    });
  } catch (error) {
    if (error instanceof PromptInjectionError) {
      return NextResponse.json(apiError('POLICY_FAILURE', error.message, true), { status: error.status });
    }

    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'General chat request failed';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'ai.general_chat.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
