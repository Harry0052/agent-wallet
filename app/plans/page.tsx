import { PlanSelection } from '@/components/plans/PlanSelection';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { redirect } from 'next/navigation';
import { getUserSubscription, getBillingState } from '@/lib/server/billing';
import { unstable_rethrow } from 'next/navigation';

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

  // If user already has an active plan, send them to the app
  const sub = await getUserSubscription(user.appUserId);
  const billing = getBillingState(sub);
  if (billing.isActive) redirect('/home');

  return <PlanSelection />;
}
