import { AppLayoutShell } from '@/components/AppLayoutShell';
import { requireAuthenticatedAppAccess } from '@/lib/server/authGuards';

export const runtime = 'nodejs';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuthenticatedAppAccess({
    loginRedirect: '/login',
    onboardingRedirect: '/onboarding',
  });
  return <AppLayoutShell>{children}</AppLayoutShell>;
}
