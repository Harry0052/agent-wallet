import Stripe from 'stripe';
import { getStripeSecretKey } from '@/lib/server/env';

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (client) return client;

  client = new Stripe(getStripeSecretKey());
  return client;
}

export function getEnabledCheckoutMethods(): Array<'card' | 'cashapp'> {
  const methods: Array<'card' | 'cashapp'> = ['card'];
  if (String(process.env.STRIPE_ENABLE_CASHAPP_PAY || '').toLowerCase() === 'true') {
    methods.push('cashapp');
  }
  return methods;
}
