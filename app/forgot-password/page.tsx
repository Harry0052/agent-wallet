import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { redirectAuthenticatedUser } from '@/lib/server/authGuards';

export default async function ForgotPasswordPage() {
  await redirectAuthenticatedUser('/home');
  return <ForgotPasswordForm />;
}
