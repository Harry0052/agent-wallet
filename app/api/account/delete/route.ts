import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser, revokeCurrentSessionFromCookies } from '@/lib/server/auth';
import { clearSessionCookie } from '@/lib/server/authCookies';
import { query } from '@/lib/server/db';
import { apiError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  confirmation: z.literal('DELETE MY ACCOUNT'),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser();
    const body = await req.json();
    const parsed = BodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Type "DELETE MY ACCOUNT" to confirm.', false),
        { status: 400 },
      );
    }

    const userId = user.appUserId;
    const walletUserId = user.walletUserId;

    logServerEvent('info', 'account.deletion.started', { userId });

    // Delete all Calico-owned user data in dependency order.
    // External Stripe records remain (legal/accounting) but local references are cleared.

    // Financial memory
    await query(`DELETE FROM user_financial_memory WHERE user_id = $1`, [userId]);

    // Persona
    await query(`DELETE FROM user_personas WHERE user_id = $1`, [userId]);

    // Onboarding state
    await query(`DELETE FROM app_user_onboarding_states WHERE user_id = $1`, [userId]);

    // User settings
    await query(`DELETE FROM app_user_settings WHERE user_id = $1`, [userId]);

    // Subscription record (local — Stripe records stay for accounting)
    await query(`DELETE FROM user_subscriptions WHERE user_id = $1`, [userId]);

    // Agent memory
    await query(`DELETE FROM agent_memory WHERE user_id = $1`, [userId]);

    // Automation actions & events
    await query(`DELETE FROM automation_action_events WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM automation_actions WHERE user_id = $1`, [userId]);

    // Subscription actions
    await query(`DELETE FROM subscription_actions WHERE user_id = $1`, [userId]);

    // Procurement
    await query(`DELETE FROM procurement_findings WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM procurement_tasks WHERE user_id = $1`, [userId]);

    // Agent tasks
    await query(`DELETE FROM agent_tasks WHERE user_id = $1`, [userId]);

    // Tasks
    await query(`DELETE FROM tasks WHERE user_id = $1`, [userId]);

    // Web action logs
    await query(`DELETE FROM web_action_logs WHERE user_id = $1`, [userId]);

    // Approval decisions
    await query(`DELETE FROM approval_decisions WHERE user_id = $1`, [userId]);

    // Financial notifications
    await query(`DELETE FROM financial_notifications WHERE user_id = $1`, [userId]);

    // Financial documents
    await query(`DELETE FROM financial_documents WHERE user_id = $1`, [userId]);

    // Autofill profile
    await query(`DELETE FROM user_autofill_profiles WHERE user_id = $1`, [walletUserId]);

    // Ledger entries
    await query(`DELETE FROM ledger_entries WHERE user_id = $1`, [walletUserId]);

    // Audit events
    await query(`DELETE FROM app_account_audit_events WHERE user_id = $1`, [userId]);

    // Sessions
    await query(`DELETE FROM app_user_sessions WHERE user_id = $1`, [userId]);

    // Password reset tokens
    await query(`DELETE FROM app_password_reset_tokens WHERE user_id = $1`, [userId]);

    // Email verification tokens
    await query(`DELETE FROM app_email_verification_tokens WHERE user_id = $1`, [userId]);

    // Password
    await query(`DELETE FROM app_user_passwords WHERE user_id = $1`, [userId]);

    // App user record (last — references depend on it)
    await query(`DELETE FROM app_users WHERE id = $1`, [userId]);

    // Revoke active session cookie
    await revokeCurrentSessionFromCookies();

    logServerEvent('info', 'account.deletion.completed', { userId });

    const response = NextResponse.json({ ok: true, deleted: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account deletion failed';
    logServerEvent('error', 'account.deletion.failed', { error: message });

    if (message.includes('Authentication required')) {
      return NextResponse.json(apiError('VALIDATION_ERROR', message, false), { status: 401 });
    }
    return NextResponse.json(apiError('UNKNOWN_FAILURE', message, true), { status: 500 });
  }
}
