import 'server-only';

import { getRequiredSecret } from '@/security/secretsManager';

export interface IndeedCredentials {
  email: string;
  password: string;
}

export function getIndeedCredentials(): IndeedCredentials {
  return {
    email: getRequiredSecret('INDEED_EMAIL'),
    password: getRequiredSecret('INDEED_PASSWORD'),
  };
}
