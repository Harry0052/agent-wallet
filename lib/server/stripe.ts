import Stripe from 'stripe';

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  client = new Stripe(key);
  return client;
}

export function getEnabledCheckoutMethods(): Array<'card' | 'cashapp'> {
  const methods: Array<'card' | 'cashapp'> = ['card'];
  if (String(process.env.STRIPE_ENABLE_CASHAPP_PAY || '').toLowerCase() === 'true') {
    methods.push('cashapp');
  }
  return methods;
}
