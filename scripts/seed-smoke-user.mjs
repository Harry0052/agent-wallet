import pg from "pg";

const { Client } = pg;

const email = process.argv[2];
const requestedPlan = process.argv[3] ?? "starter";
const allowedPlans = new Set(["starter", "pro", "autonomous"]);

if (!email) {
  throw new Error("Expected email argument.");
}

if (!allowedPlans.has(requestedPlan)) {
  throw new Error(`Unsupported plan: ${requestedPlan}`);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  const userResult = await client.query(
    "SELECT id FROM app_users WHERE email = $1 LIMIT 1",
    [email],
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) {
    throw new Error(`User not found: ${email}`);
  }

  await client.query(
    `INSERT INTO user_subscriptions (
       user_id, stripe_customer_id, stripe_subscription_id, plan, status,
       trial_start, trial_end, current_period_start, current_period_end,
       cancel_at_period_end, last_webhook_event_id
     ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '14 days', NOW(), NOW() + INTERVAL '14 days', FALSE, $6)
     ON CONFLICT (user_id)
     DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       trial_start = EXCLUDED.trial_start,
       trial_end = EXCLUDED.trial_end,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       last_webhook_event_id = EXCLUDED.last_webhook_event_id,
       updated_at = NOW()`,
    [
      userId,
      `cus_smoke_${userId.slice(-8)}`,
      `sub_smoke_${userId.slice(-8)}`,
      requestedPlan,
      "trialing",
      "evt_smoke_seed",
    ],
  );

  await client.query(
    `UPDATE app_user_onboarding_states
     SET onboarding_step = 'complete',
         onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()),
         skipped_tool_setup = TRUE,
         preferences = COALESCE(preferences, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId, JSON.stringify({ seededForSmoke: true })],
  );

  console.log(JSON.stringify({ ok: true, email, userId, plan: requestedPlan }));
} finally {
  await client.end();
}
