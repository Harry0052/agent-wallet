import 'server-only';
import Stripe from 'stripe';
import { getEnabledCheckoutMethods, getStripeClient } from '@/lib/server/stripe';
import {
  getDefaultSavedPaymentMethodForUser,
  getSavedPaymentMethodForUser,
  getStripeCustomerIdForUser,
  listUsersWithActivePaymentMethods,
  listSavedPaymentMethodsForUser,
  markPaymentMethodRemovedForUser,
  setStripeCustomerIdForUser,
  upsertSavedPaymentMethodForUser,
} from '@/lib/server/fundingPaymentMethods';
import {
  ensureStripeToolForUser,
  resolveToolForAction,
  setStripeToolConnectedFromFunding,
  setStripeToolDisconnected,
  setStripeToolNeedsReconnect,
} from '@/lib/server/toolsVault';
import type { SavedPaymentMethod } from '@/lib/types';
import { getPublicAppOrigin } from '@/lib/publicOrigin';

function resolveAppOrigin(): string {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (explicit && /^https?:\/\//i.test(explicit)) {
    return explicit.replace(/\/+$/, '');
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
  }

  return getPublicAppOrigin();
}

function normalizeTopupAmountCents(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid top-up amount');
  }

  const cents = Math.round(amount * 100);
  if (cents < 50) {
    throw new Error('Minimum top-up is $0.50');
  }

  return cents;
}

function cardBrandText(brand: string | null | undefined): string {
  if (!brand) return 'Card';
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function paymentMethodDisplayLabel(method: Pick<SavedPaymentMethod, 'brand' | 'last4'>): string {
  const brand = cardBrandText(method.brand);
  const suffix = method.last4 ? `**** ${method.last4}` : 'saved method';
  return `${brand} ${suffix}`;
}

async function assertStripeToolReadyForFunding(userId: string): Promise<void> {
  await ensureStripeToolForUser(userId);
  const stripeTool = await resolveToolForAction({ userId, toolKey: 'stripe' });
  if (!stripeTool) {
    throw new Error('Stripe is not connected. Set up Stripe in Connect first.');
  }

  if (stripeTool.status === 'failed') {
    throw new Error('Stripe needs reconnect. Reconnect Stripe in Connect before funding.');
  }

  if (!stripeTool.enabled && stripeTool.status === 'disconnected' && !stripeTool.hasSecret) {
    throw new Error('Stripe is not connected. Set up Stripe in Connect first.');
  }

  if (!stripeTool.enabled) {
    throw new Error('Stripe is disabled. Enable Stripe in Connect before funding.');
  }

  if (stripeTool.status === 'disconnected') {
    throw new Error('Stripe needs reconnect. Reconnect Stripe in Connect before funding.');
  }
}

export async function getOrCreateStripeCustomerForWallet(userId: string): Promise<string> {
  const stripe = getStripeClient();
  const existing = await getStripeCustomerIdForUser(userId);
  if (existing) {
    try {
      const customer = await stripe.customers.retrieve(existing);
      if (!('deleted' in customer)) {
        return customer.id;
      }
    } catch {
      // If the customer no longer exists in Stripe, create a new one.
    }
  }

  const created = await stripe.customers.create({
    metadata: {
      wallet_user_id: userId,
    },
  });

  await setStripeCustomerIdForUser(userId, created.id);
  return created.id;
}

export async function createTopupCheckoutSession(params: {
  userId: string;
  amount: number;
  origin?: string;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  await assertStripeToolReadyForFunding(params.userId);

  const cents = normalizeTopupAmountCents(params.amount);
  const stripe = getStripeClient();
  const origin = params.origin || resolveAppOrigin();
  const customerId = await getOrCreateStripeCustomerForWallet(params.userId);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    payment_method_types: getEnabledCheckoutMethods(),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: 'Agent Wallet top-up',
          },
        },
      },
    ],
    payment_intent_data: {
      metadata: {
        wallet_action: 'topup',
        wallet_user_id: params.userId,
      },
    },
    success_url: `${origin}/?funding_status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?funding_cancelled=1`,
    metadata: {
      wallet_action: 'topup',
      wallet_user_id: params.userId,
    },
  });

  if (!session.url) {
    throw new Error('Unable to create Stripe checkout URL');
  }

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
  };
}

export async function createSetupCheckoutSession(params: {
  userId: string;
  origin?: string;
  consentMetadata?: Record<string, unknown> | null;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  await ensureStripeToolForUser(params.userId);

  const stripe = getStripeClient();
  const origin = params.origin || resolveAppOrigin();
  const customerId = await getOrCreateStripeCustomerForWallet(params.userId);

  const metadata: Record<string, string> = {
    wallet_action: 'save_payment_method',
    wallet_user_id: params.userId,
    consent_source: 'wallet_setup_checkout',
  };

  if (params.consentMetadata) {
    const consentSource = params.consentMetadata.consentSource;
    if (typeof consentSource === 'string' && consentSource.trim()) {
      metadata.consent_source = consentSource.trim().slice(0, 80);
    }

    const consentVersion = params.consentMetadata.consentVersion;
    if (typeof consentVersion === 'string' && consentVersion.trim()) {
      metadata.consent_version = consentVersion.trim().slice(0, 40);
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: customerId,
    payment_method_types: ['card'],
    success_url: `${origin}/wallet?funding_setup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/wallet?funding_setup=cancelled`,
    metadata,
  });

  if (!session.url) {
    throw new Error('Unable to create setup checkout URL');
  }

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
  };
}

export async function createFundingSetupIntent(params: {
  userId: string;
  consentMetadata?: Record<string, unknown> | null;
}): Promise<{
  clientSecret: string;
  setupIntentId: string;
}> {
  await ensureStripeToolForUser(params.userId);

  const stripe = getStripeClient();
  const customerId = await getOrCreateStripeCustomerForWallet(params.userId);

  const metadata: Record<string, string> = {
    wallet_action: 'save_payment_method',
    wallet_user_id: params.userId,
    consent_source: 'wallet_setup_embedded',
  };

  if (params.consentMetadata) {
    const consentSource = params.consentMetadata.consentSource;
    if (typeof consentSource === 'string' && consentSource.trim()) {
      metadata.consent_source = consentSource.trim().slice(0, 80);
    }

    const consentVersion = params.consentMetadata.consentVersion;
    if (typeof consentVersion === 'string' && consentVersion.trim()) {
      metadata.consent_version = consentVersion.trim().slice(0, 40);
    }
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never',
    },
    metadata,
  });

  if (!setupIntent.client_secret) {
    throw new Error('Unable to create setup intent client secret');
  }

  return {
    clientSecret: setupIntent.client_secret,
    setupIntentId: setupIntent.id,
  };
}

export async function saveSetupSessionPaymentMethod(params: {
  session: Stripe.Checkout.Session;
}): Promise<SavedPaymentMethod | null> {
  const userId = params.session.metadata?.wallet_user_id?.trim();
  if (!userId) return null;

  if (params.session.mode !== 'setup') return null;

  const setupIntentId = typeof params.session.setup_intent === 'string'
    ? params.session.setup_intent
    : null;
  if (!setupIntentId) return null;

  const stripe = getStripeClient();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {
    expand: ['payment_method'],
  });

  const pm = typeof setupIntent.payment_method === 'object' && setupIntent.payment_method
    ? setupIntent.payment_method
    : null;

  const paymentMethodId = pm?.id || (typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : null);
  if (!paymentMethodId) return null;

  const customerId = typeof setupIntent.customer === 'string'
    ? setupIntent.customer
    : typeof params.session.customer === 'string'
      ? params.session.customer
      : null;

  if (!customerId) {
    throw new Error('Setup session completed without a Stripe customer');
  }

  const card = pm?.type === 'card' ? pm.card : null;

  const saved = await upsertSavedPaymentMethodForUser({
    userId,
    stripeCustomerId: customerId,
    stripePaymentMethodId: paymentMethodId,
    brand: card?.brand || null,
    last4: card?.last4 || null,
    expMonth: card?.exp_month || null,
    expYear: card?.exp_year || null,
    funding: card?.funding || null,
    consentMetadata: {
      source: params.session.metadata?.consent_source || 'wallet_setup_checkout',
      sessionId: params.session.id,
      setupIntentId,
      consentVersion: params.session.metadata?.consent_version || 'v1',
    },
    setAsDefault: true,
  });

  await setStripeToolConnectedFromFunding({
    userId,
    loginIdentifierMasked: paymentMethodDisplayLabel(saved),
    label: 'Payment setup',
  });

  return saved;
}

export async function saveSetupIntentPaymentMethod(params: {
  userId: string;
  setupIntentId: string;
}): Promise<SavedPaymentMethod> {
  const setupIntentId = params.setupIntentId.trim();
  if (!setupIntentId) {
    throw new Error('setupIntentId is required');
  }

  const stripe = getStripeClient();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {
    expand: ['payment_method'],
  });

  if (setupIntent.status !== 'succeeded') {
    throw new Error('Payment setup is not complete yet');
  }

  const metadataUserId = typeof setupIntent.metadata?.wallet_user_id === 'string'
    ? setupIntent.metadata.wallet_user_id.trim()
    : '';
  if (metadataUserId && metadataUserId !== params.userId) {
    throw new Error('Setup intent user mismatch');
  }

  const pm = typeof setupIntent.payment_method === 'object' && setupIntent.payment_method
    ? setupIntent.payment_method
    : null;
  const paymentMethodId = pm?.id || (typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : null);
  if (!paymentMethodId) {
    throw new Error('Setup intent did not return a payment method');
  }

  const customerId = typeof setupIntent.customer === 'string' ? setupIntent.customer : null;
  if (!customerId) {
    throw new Error('Setup intent missing customer');
  }

  const card = pm?.type === 'card' ? pm.card : null;

  const saved = await upsertSavedPaymentMethodForUser({
    userId: params.userId,
    stripeCustomerId: customerId,
    stripePaymentMethodId: paymentMethodId,
    brand: card?.brand || null,
    last4: card?.last4 || null,
    expMonth: card?.exp_month || null,
    expYear: card?.exp_year || null,
    funding: card?.funding || null,
    consentMetadata: {
      source: setupIntent.metadata?.consent_source || 'wallet_setup_embedded',
      setupIntentId: setupIntent.id,
      consentVersion: setupIntent.metadata?.consent_version || 'v1',
    },
    setAsDefault: true,
  });

  await setStripeToolConnectedFromFunding({
    userId: params.userId,
    loginIdentifierMasked: paymentMethodDisplayLabel(saved),
    label: 'Payment setup',
  });

  return saved;
}

export async function listSavedFundingMethods(userId: string): Promise<SavedPaymentMethod[]> {
  return listSavedPaymentMethodsForUser(userId);
}

export async function removeSavedFundingMethod(input: {
  userId: string;
  stripePaymentMethodId: string;
}): Promise<void> {
  const method = await getSavedPaymentMethodForUser({
    userId: input.userId,
    stripePaymentMethodId: input.stripePaymentMethodId,
  });

  if (!method || method.status !== 'active') {
    throw new Error('Saved payment method not found');
  }

  const stripe = getStripeClient();
  try {
    await stripe.paymentMethods.detach(method.stripePaymentMethodId);
  } catch {
    // Continue cleanup in local db even if Stripe says it's already detached.
  }

  await markPaymentMethodRemovedForUser({
    userId: input.userId,
    stripePaymentMethodId: method.stripePaymentMethodId,
  });

  const hasRemainingActiveMethod = await listUsersWithActivePaymentMethods(input.userId);
  if (!hasRemainingActiveMethod) {
    await setStripeToolDisconnected({
      userId: input.userId,
      reason: 'Stripe payment method removed',
    });
  }
}

export async function chargeSavedPaymentMethodTopup(input: {
  userId: string;
  amount: number;
  stripePaymentMethodId?: string | null;
  forgetAfterUse?: boolean;
}): Promise<
  | {
    status: 'succeeded';
    paymentIntentId: string;
    amount: number;
    paymentMethod: SavedPaymentMethod;
    detachedAfterUse: boolean;
  }
  | {
    status: 'requires_action';
    message: string;
    paymentIntentId: string;
    amount: number;
    paymentMethod: SavedPaymentMethod;
    checkoutUrl: string;
    sessionId: string;
  }
> {
  await assertStripeToolReadyForFunding(input.userId);

  const cents = normalizeTopupAmountCents(input.amount);
  const paymentMethod = input.stripePaymentMethodId
    ? await getSavedPaymentMethodForUser({
      userId: input.userId,
      stripePaymentMethodId: input.stripePaymentMethodId,
    })
    : await getDefaultSavedPaymentMethodForUser(input.userId);

  if (!paymentMethod || paymentMethod.status !== 'active') {
    throw new Error('No saved payment method is available');
  }

  const stripe = getStripeClient();
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: cents,
      currency: 'usd',
      customer: paymentMethod.stripeCustomerId,
      payment_method: paymentMethod.stripePaymentMethodId,
      payment_method_types: ['card'],
      off_session: false,
      confirm: true,
      metadata: {
        wallet_action: 'topup',
        wallet_user_id: input.userId,
        wallet_saved_payment_method_id: paymentMethod.stripePaymentMethodId,
      },
    });
  } catch (error) {
    const maybeStripeError = error as {
      code?: string;
      raw?: { payment_intent?: Stripe.PaymentIntent };
    };
    const erroredIntent = maybeStripeError.raw?.payment_intent;
    const needsAuth = maybeStripeError.code === 'authentication_required'
      || erroredIntent?.status === 'requires_action';

    if (!needsAuth) {
      throw error;
    }

    const fallback = await createTopupCheckoutSession({
      userId: input.userId,
      amount: input.amount,
    });

    return {
      status: 'requires_action',
      message: 'Payment needs verification.',
      paymentIntentId: erroredIntent?.id || 'pending_authentication',
      amount: input.amount,
      paymentMethod,
      checkoutUrl: fallback.checkoutUrl,
      sessionId: fallback.sessionId,
    };
  }

  if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
    let detachedAfterUse = false;
    if (input.forgetAfterUse) {
      try {
        await stripe.paymentMethods.detach(paymentMethod.stripePaymentMethodId);
      } finally {
        await markPaymentMethodRemovedForUser({
          userId: input.userId,
          stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
        });
        detachedAfterUse = true;
      }
    }

    return {
      status: 'succeeded',
      paymentIntentId: paymentIntent.id,
      amount: input.amount,
      paymentMethod,
      detachedAfterUse,
    };
  }

  const fallback = await createTopupCheckoutSession({
    userId: input.userId,
    amount: input.amount,
  });

  return {
    status: 'requires_action',
    message: 'Payment needs verification.',
    paymentIntentId: paymentIntent.id,
    amount: input.amount,
    paymentMethod,
    checkoutUrl: fallback.checkoutUrl,
    sessionId: fallback.sessionId,
  };
}

export async function syncStripePaymentMethodAsSaved(input: {
  userId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  consentMetadata?: Record<string, unknown> | null;
  setAsDefault?: boolean;
}): Promise<SavedPaymentMethod> {
  const stripe = getStripeClient();
  const paymentMethod = await stripe.paymentMethods.retrieve(input.stripePaymentMethodId);
  const card = paymentMethod.type === 'card' ? paymentMethod.card : null;

  const saved = await upsertSavedPaymentMethodForUser({
    userId: input.userId,
    stripeCustomerId: input.stripeCustomerId,
    stripePaymentMethodId: input.stripePaymentMethodId,
    brand: card?.brand || null,
    last4: card?.last4 || null,
    expMonth: card?.exp_month || null,
    expYear: card?.exp_year || null,
    funding: card?.funding || null,
    consentMetadata: input.consentMetadata,
    setAsDefault: input.setAsDefault,
  });

  await setStripeToolConnectedFromFunding({
    userId: input.userId,
    loginIdentifierMasked: paymentMethodDisplayLabel(saved),
    label: 'Payment setup',
  });

  return saved;
}

export async function markStripeDisconnectedFromExternalDetach(input: {
  userId: string;
  reason?: string;
}): Promise<void> {
  const hasRemainingActiveMethod = await listUsersWithActivePaymentMethods(input.userId);
  if (hasRemainingActiveMethod) return;

  await setStripeToolNeedsReconnect({
    userId: input.userId,
    reason: input.reason || 'Stripe payment method was detached',
  });
}
