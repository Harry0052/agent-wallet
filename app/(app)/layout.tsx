import { AppLayoutShell } from '@/components/AppLayoutShell';
import { requireOnboardingCompleted, requirePageAuth } from '@/lib/server/authGuards';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requirePageAuth('/login');
  await requireOnboardingCompleted('/onboarding');
  return <AppLayoutShell>{children}</AppLayoutShell>;
}
