import { AuthForm } from '@/components/auth/AuthForm';
import { redirectAuthenticatedUser } from '@/lib/server/authGuards';

export default async function SignupPage() {
  await redirectAuthenticatedUser('/operator');
  return <AuthForm mode="signup" />;
}
