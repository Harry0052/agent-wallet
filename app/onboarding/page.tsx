import { OnboardingGate } from '@/components/onboarding/OnboardingGate';
import { requirePendingOnboarding } from '@/lib/server/authGuards';

export default async function OnboardingPage() {
  await requirePendingOnboarding('/home');
  return <OnboardingGate />;
}
