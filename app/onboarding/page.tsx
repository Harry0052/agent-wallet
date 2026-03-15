import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { requirePendingOnboarding } from '@/lib/server/authGuards';

export default async function OnboardingPage() {
  await requirePendingOnboarding('/home');
  return <OnboardingFlow />;
}
