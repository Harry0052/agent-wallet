import { PlanSelection } from '@/components/plans/PlanSelection';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { redirect } from 'next/navigation';
import { getUserSubscription, getBillingState } from '@/lib/server/billing';

export default async function PlansPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect('/login');

  // If user already has an active plan, send them to the app
  const sub = await getUserSubscription(user.appUserId);
  const billing = getBillingState(sub);
  if (billing.isActive) redirect('/home');

  return <PlanSelection />;
}
