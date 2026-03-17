import 'server-only';

import { query } from '@/lib/server/db';
import { getStripeClient } from '@/lib/server/stripe';
import { getRequiredSecret, getOptionalSecret } from '@/security/secretsManager';
import type Stripe from 'stripe';

// ── Plan definitions ────────────────────────────────────────────────────────

export type PlanId = 'starter' | 'pro' | 'autonomous';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMonthly: number;
  trialDays: number;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 8.99,
    trialDays: 14,
    features: [
      'Connect up to 3 accounts',
      'See all your money moves',
      'Simple spending plan',
      'Find repeating payments',
      'Weekly & monthly recaps',
      'Ask Calico basic questions',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 29.99,
    trialDays: 0,
    features: [
      'Everything in Starter',
      'Unlimited accounts',
      'Smarter money tips',
      'Spending trend explanations',
      '"Can I afford this?" feature',
      'What\'s Coming predictions',
      'Custom spending groups',
      'Priority support',
    ],
  },
  autonomous: {
    id: 'autonomous',
    name: 'Fully Autonomous',
    priceMonthly: 89.99,
    trialDays: 0,
    features: [
      'Everything in Pro',
      'Calico moves money for you',
      'Auto-fund your goals',
      'Bill negotiation help',
      'Subscription cancel workflows',
      'Smart debt payoff plans',
      'Action center & automations',
      'API access',
    ],
  },
};

const PLAN_HIERARCHY: PlanId[] = ['starter', 'pro', 'autonomous'];

// ── Env helpers ─────────────────────────────────────────────────────────────

function getStripePriceId(plan: PlanId): string {
  const envMap: Record<PlanId, string> = {
    starter: 'STRIPE_PRICE_STARTER_MONTHLY',
    pro: 'STRIPE_PRICE_PRO_MONTHLY',
    autonomous: 'STRIPE_PRICE_AUTONOMOUS_MONTHLY',
  };
  const envKey = envMap[plan];
  const priceId = getRequiredSecret(envKey);
  if (!priceId.startsWith('price_')) {
    throw new Error(
      `${envKey} does not look like a valid Stripe price ID (expected "price_..." prefix, got "${priceId.slice(0, 12)}...")`,
    );
  }
  return priceId;
}

function getStripeWebhookSecretBilling(): string {
  const explicit = getOptionalSecret('STRIPE_WEBHOOK_SECRET_BILLING');
  if (explicit) return explicit;
  return getRequiredSecret('STRIPE_WEBHOOK_SECRET');
}

// ── Subscription row type ───────────────────────────────────────────────────

export interface UserSubscription {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  plan: PlanId;
  status: string;
  trialStart: string | null;
  trialEnd: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastWebhookEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionRow {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  last_webhook_event_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSubscription(row: SubscriptionRow): UserSubscription {
  return {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    plan: row.plan as PlanId,
    status: row.status,
    trialStart: row.trial_start,
    trialEnd: row.trial_end,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    lastWebhookEventId: row.last_webhook_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── DB queries ──────────────────────────────────────────────────────────────

export async function getUserSubscription(userId: string): Promise<UserSubscription | null> {
  const result = await query<SubscriptionRow>(
    `SELECT user_id, stripe_customer_id, stripe_subscription_id, plan, status,
            trial_start::text, trial_end::text,
            current_period_start::text, current_period_end::text,
            cancel_at_period_end, last_webhook_event_id,
            created_at::text, updated_at::text
     FROM user_subscriptions WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (!result.rows[0]) return null;
  return rowToSubscription(result.rows[0]);
}

export async function getUserSubscriptionByStripeCustomerId(
  stripeCustomerId: string,
): Promise<UserSubscription | null> {
  const result = await query<SubscriptionRow>(
    `SELECT user_id, stripe_customer_id, stripe_subscription_id, plan, status,
            trial_start::text, trial_end::text,
            current_period_start::text, current_period_end::text,
            cancel_at_period_end, last_webhook_event_id,
            created_at::text, updated_at::text
     FROM user_subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
    [stripeCustomerId],
  );
  if (!result.rows[0]) return null;
  return rowToSubscription(result.rows[0]);
}

export async function upsertUserSubscription(params: {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  plan: PlanId;
  status: string;
  trialStart?: string | null;
  trialEnd?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  lastWebhookEventId?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO user_subscriptions (
       user_id, stripe_customer_id, stripe_subscription_id, plan, status,
       trial_start, trial_end, current_period_start, current_period_end,
       cancel_at_period_end, last_webhook_event_id
     ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz,
               $8::timestamptz, $9::timestamptz, $10, $11)
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
       last_webhook_event_id = COALESCE(EXCLUDED.last_webhook_event_id, user_subscriptions.last_webhook_event_id),
       updated_at = NOW()`,
    [
      params.userId,
      params.stripeCustomerId,
      params.stripeSubscriptionId || null,
      params.plan,
      params.status,
      params.trialStart || null,
      params.trialEnd || null,
      params.currentPeriodStart || null,
      params.currentPeriodEnd || null,
      params.cancelAtPeriodEnd ?? false,
      params.lastWebhookEventId || null,
    ],
  );
}

// ── Stripe customer resolution ──────────────────────────────────────────────

async function findUserIdByStripeSubscriptionId(
  stripeSubscriptionId: string,
): Promise<string | null> {
  const result = await query<{ user_id: string }>(
    `SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
    [stripeSubscriptionId],
  );
  return result.rows[0]?.user_id || null;
}

export async function getOrCreateStripeCustomer(params: {
  userId: string;
  email: string;
}): Promise<string> {
  const existing = await getUserSubscription(params.userId);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: params.email,
    metadata: { app_user_id: params.userId },
  });
  return customer.id;
}

// ── Checkout ────────────────────────────────────────────────────────────────

export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  plan: PlanId;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const planDef = PLANS[params.plan];
  if (!planDef) throw new Error(`Unknown plan: ${params.plan}`);

  const priceId = getStripePriceId(params.plan);
  const stripeCustomerId = await getOrCreateStripeCustomer({
    userId: params.userId,
    email: params.email,
  });

  const stripe = getStripeClient();

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      app_user_id: params.userId,
      plan: params.plan,
    },
    subscription_data: {
      metadata: {
        app_user_id: params.userId,
        plan: params.plan,
      },
    },
    allow_promotion_codes: true,
  };

  if (planDef.trialDays > 0) {
    sessionParams.subscription_data!.trial_period_days = planDef.trialDays;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}

// ── Customer Portal ─────────────────────────────────────────────────────────

export async function createPortalSession(params: {
  userId: string;
  returnUrl: string;
}): Promise<string> {
  const sub = await getUserSubscription(params.userId);
  if (!sub?.stripeCustomerId) {
    throw new Error('No billing account found. Subscribe to a plan first.');
  }

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: params.returnUrl,
  });
  return session.url;
}

// ── Entitlements ────────────────────────────────────────────────────────────

export interface BillingState {
  plan: PlanId | null;
  status: string;
  isActive: boolean;
  isTrial: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
}

export function getBillingState(sub: UserSubscription | null): BillingState {
  if (!sub) {
    return {
      plan: null,
      status: 'none',
      isActive: false,
      isTrial: false,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      trialEnd: null,
    };
  }

  const activeStatuses = ['active', 'trialing'];
  const isActive = activeStatuses.includes(sub.status);
  const isTrial = sub.status === 'trialing';

  return {
    plan: sub.plan as PlanId,
    status: sub.status,
    isActive,
    isTrial,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    currentPeriodEnd: sub.currentPeriodEnd,
    trialEnd: sub.trialEnd,
  };
}

export function hasFeatureAccess(billing: BillingState, requiredPlan: PlanId): boolean {
  if (!billing.isActive || !billing.plan) return false;

  const userLevel = PLAN_HIERARCHY.indexOf(billing.plan);
  const requiredLevel = PLAN_HIERARCHY.indexOf(requiredPlan);
  return userLevel >= requiredLevel;
}

export function getUserPlanAction(billing: BillingState, targetPlan: PlanId): 'subscribe' | 'current' | 'upgrade' | 'downgrade' {
  if (!billing.plan || !billing.isActive) return 'subscribe';
  if (billing.plan === targetPlan) return 'current';

  const currentLevel = PLAN_HIERARCHY.indexOf(billing.plan);
  const targetLevel = PLAN_HIERARCHY.indexOf(targetPlan);
  return targetLevel > currentLevel ? 'upgrade' : 'downgrade';
}

// ── Webhook processing ──────────────────────────────────────────────────────

function planFromStripeSub(sub: Stripe.Subscription): PlanId {
  const meta = sub.metadata?.plan;
  if (meta && (meta === 'starter' || meta === 'pro' || meta === 'autonomous')) {
    return meta;
  }
  // fallback: try to match by price
  const priceId = sub.items.data[0]?.price?.id;
  if (priceId) {
    try {
      if (priceId === getStripePriceId('starter')) return 'starter';
    } catch { /* env not set */ }
    try {
      if (priceId === getStripePriceId('pro')) return 'pro';
    } catch { /* env not set */ }
    try {
      if (priceId === getStripePriceId('autonomous')) return 'autonomous';
    } catch { /* env not set */ }
  }
  return 'starter';
}

function resolveUserIdFromSubscription(sub: Stripe.Subscription): string | null {
  return sub.metadata?.app_user_id || null;
}

async function resolveUserIdFromCustomer(customerId: string): Promise<string | null> {
  const row = await getUserSubscriptionByStripeCustomerId(customerId);
  if (row) return row.userId;

  const stripe = getStripeClient();
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return null;
  return (customer as Stripe.Customer).metadata?.app_user_id || null;
}

export async function handleSubscriptionWebhookEvent(event: Stripe.Event): Promise<void> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== 'subscription') return;

    const userId = session.metadata?.app_user_id;
    const plan = (session.metadata?.plan || 'starter') as PlanId;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

    if (!userId || !customerId) return;

    if (subscriptionId) {
      const stripe = getStripeClient();
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await upsertUserSubscription({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        plan: planFromStripeSub(sub),
        status: sub.status,
        trialStart: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        currentPeriodStart: new Date(sub.items.data[0].current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        lastWebhookEventId: event.id,
      });
    } else {
      await upsertUserSubscription({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: null,
        plan,
        status: 'active',
        lastWebhookEventId: event.id,
      });
    }
    return;
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    if (!customerId) return;

    let userId = resolveUserIdFromSubscription(sub);
    if (!userId) {
      userId = await findUserIdByStripeSubscriptionId(sub.id);
    }
    if (!userId) {
      userId = await resolveUserIdFromCustomer(customerId);
    }
    if (!userId) return;

    await upsertUserSubscription({
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      plan: planFromStripeSub(sub),
      status: sub.status,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      currentPeriodStart: new Date(sub.items.data[0].current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      lastWebhookEventId: event.id,
    });
    return;
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as { id: string } | null)?.id;
    const rawSub = (invoice as unknown as Record<string, unknown>).subscription;
    const subscriptionId = typeof rawSub === 'string' ? rawSub : (rawSub as { id: string } | null)?.id;
    if (!customerId || !subscriptionId) return;

    const stripe = getStripeClient();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);

    let userId = resolveUserIdFromSubscription(sub);
    if (!userId) userId = await findUserIdByStripeSubscriptionId(sub.id);
    if (!userId) userId = await resolveUserIdFromCustomer(customerId);
    if (!userId) return;

    await upsertUserSubscription({
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      plan: planFromStripeSub(sub),
      status: sub.status,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      currentPeriodStart: new Date(sub.items.data[0].current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      lastWebhookEventId: event.id,
    });
    return;
  }

  if (event.type === 'customer.subscription.trial_will_end') {
    // informational — no state change needed, subscription is still trialing
    return;
  }
}

export { getStripeWebhookSecretBilling };
