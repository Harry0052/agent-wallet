import { PlanSelection } from '@/components/plans/PlanSelection';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getUserSubscription, getBillingState } from '@/lib/server/billing';

export default async function PlansPage() {
  let user = null;
  try {
    user = await getAuthenticatedUser();
  } catch (error) {
    unstable_rethrow(error);
    console.error('[plans] failed to resolve authenticated user', error);
    redirect('/login');
  }

  if (!user) redirect('/login');

  // If user already has an active plan, send them to the app.
  // Wrapped in try-catch so a transient DB failure (pool exhaustion)
  // does not crash the page with a server-side exception.
  try {
    const sub = await getUserSubscription(user.appUserId);
    const billing = getBillingState(sub);
    if (billing.isActive) redirect('/home');
  } catch (error) {
    unstable_rethrow(error);
    // DB temporarily unreachable — show the plan selection anyway.
    // The user can still select a plan; the checkout flow will verify
    // subscription state before creating a duplicate.
    console.error('[plans] failed to check subscription status:', error instanceof Error ? error.message : error);
  }

  return <PlanSelection />;
}
