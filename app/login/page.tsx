import { AuthForm } from '@/components/auth/AuthForm';
import { redirectAuthenticatedUser } from '@/lib/server/authGuards';

export default async function LoginPage() {
  await redirectAuthenticatedUser('/home');
  return <AuthForm mode="login" />;
}
