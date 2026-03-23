import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnostic health endpoint — reports which required env vars are present
 * without exposing values. Deploy this, hit /api/debug/health, and see
 * exactly which secrets are missing in production.
 *
 * DELETE THIS ROUTE after debugging is complete.
 */
export async function GET() {
  const required = [
    'DATABASE_URL',
    'AUTH_SESSION_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'PLAID_CLIENT_ID',
    'PLAID_SECRET',
  ];

  const oneOf = [
    ['DATA_ENCRYPTION_KEYRING', 'DATA_ENCRYPTION_MASTER_KEY'],
    ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  ];

  const optional = [
    'NEXT_PUBLIC_APP_ORIGIN',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI',
    'RESEND_API_KEY',
    'FEEDBACK_TO_EMAIL',
    'TINY_FISH_API_URL',
    'TINY_FISH_API_KEY',
    'DATA_ENCRYPTION_HASH_KEY',
    'DATA_ENCRYPTION_ACTIVE_KEY_VERSION',
  ];

  const check = (key: string) => {
    const val = process.env[key];
    if (!val) return 'MISSING';
    if (val.length < 3) return 'TOO_SHORT';
    return 'OK';
  };

  const requiredStatus = Object.fromEntries(
    required.map((k) => [k, check(k)]),
  );

  const oneOfStatus = oneOf.map((group) => ({
    keys: group,
    status: group.some((k) => check(k) === 'OK') ? 'OK' : 'ALL_MISSING',
    detail: Object.fromEntries(group.map((k) => [k, check(k)])),
  }));

  const optionalStatus = Object.fromEntries(
    optional.map((k) => [k, check(k)]),
  );

  const allRequiredOk = Object.values(requiredStatus).every((v) => v === 'OK');
  const allOneOfOk = oneOfStatus.every((g) => g.status === 'OK');

  // Check which secrets are missing
  const missingForCrash: string[] = [];

  for (const [key, status] of Object.entries(requiredStatus)) {
    if (status !== 'OK') {
      missingForCrash.push(key);
    }
  }
  for (const group of oneOfStatus) {
    if (group.status !== 'OK') {
      missingForCrash.push(`one of [${group.keys.join(', ')}]`);
    }
  }

  // Check NEXT_PUBLIC_APP_ORIGIN for Google OAuth
  const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN || '(not set — defaults to https://startcalico.com)';

  // Check what instrumentation detected on startup
  const startupMissing = (globalThis as Record<string, unknown>).__agentWalletMissingStartupSecrets as string[] | undefined;

  return NextResponse.json({
    ok: allRequiredOk && allOneOfOk,
    serverBootedSuccessfully: true,
    missingSecretsDetectedAtStartup: startupMissing ?? [],
    missingSecretsDetectedNow: missingForCrash,
    appOrigin,
    nodeEnv: process.env.NODE_ENV,
    nextRuntime: process.env.NEXT_RUNTIME,
    required: requiredStatus,
    oneOf: oneOfStatus,
    optional: optionalStatus,
    timestamp: new Date().toISOString(),
    note: 'DELETE /app/api/debug/health/route.ts after debugging',
  });
}
