import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { logServerEvent } from '@/lib/server/observability';
import { getUserSubscription, getBillingState } from '@/lib/server/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  feature_request: 'Feature Request',
  bug: 'Bug Report',
  praise: 'Praise',
};

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'auth', scope: 'feedback' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  let body: { message?: unknown; category?: unknown; route?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const category = typeof body.category === 'string' ? body.category : 'general';
  const route = typeof body.route === 'string' ? body.route : 'unknown';

  if (!message || message.length > 2000) {
    return NextResponse.json(
      { ok: false, error: 'Feedback must be between 1 and 2000 characters.' },
      { status: 400 },
    );
  }

  const validCategories = ['general', 'feature_request', 'bug', 'praise'];
  if (!validCategories.includes(category)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid category.' },
      { status: 400 },
    );
  }

  // Resolve user plan
  let plan = 'unknown';
  try {
    const sub = await getUserSubscription(auth.auth.walletUserId);
    if (sub) {
      const billing = getBillingState(sub);
      plan = billing.plan ?? 'none';
    }
  } catch { /* non-critical */ }

  const userId = auth.auth.walletUserId;
  const userEmail = auth.auth.email;
  const timestamp = new Date().toISOString();

  // Send email via Resend
  const resendApiKey = process.env.RESEND_API_KEY;
  const feedbackToEmail = process.env.FEEDBACK_TO_EMAIL;

  if (!resendApiKey || !feedbackToEmail) {
    logServerEvent('error', 'feedback.email_not_configured', {
      hasResendKey: Boolean(resendApiKey),
      hasFeedbackEmail: Boolean(feedbackToEmail),
    });
    return NextResponse.json(
      { ok: false, error: 'Feedback service is not configured.' },
      { status: 503 },
    );
  }

  const resend = new Resend(resendApiKey);
  const categoryLabel = CATEGORY_LABELS[category] || category;

  try {
    const { error: sendError } = await resend.emails.send({
      from: 'Agent Wallet Feedback <onboarding@resend.dev>',
      to: [feedbackToEmail],
      subject: `Agent Wallet Feedback — ${categoryLabel}`,
      text: [
        `New feedback from Agent Wallet`,
        ``,
        `Category:  ${categoryLabel}`,
        `User ID:   ${userId}`,
        `Email:     ${userEmail}`,
        `Plan:      ${plan}`,
        `Page:      ${route}`,
        `Time:      ${timestamp}`,
        ``,
        `--- Message ---`,
        ``,
        message,
        ``,
        `--- End ---`,
      ].join('\n'),
    });

    if (sendError) {
      logServerEvent('error', 'feedback.send_failed', {
        userId,
        category,
        error: sendError.message,
      });
      return NextResponse.json(
        { ok: false, error: 'Failed to send feedback. Please try again.' },
        { status: 500 },
      );
    }

    logServerEvent('info', 'feedback.sent', {
      userId,
      category,
      messageLength: message.length,
      route,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logServerEvent('error', 'feedback.send_error', {
      userId,
      category,
      error: msg,
    });
    return NextResponse.json(
      { ok: false, error: 'Failed to send feedback. Please try again.' },
      { status: 500 },
    );
  }
}
