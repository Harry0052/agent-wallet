import type { UserAutofillProfile } from '@/lib/types';

export type ProfileFieldKey =
  | 'full_name'
  | 'email'
  | 'phone'
  | 'company_name'
  | 'billing_name'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state_region'
  | 'postal_code'
  | 'country';

export interface FormFillFieldMap {
  fullName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  billingName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateRegion?: string;
  postalCode?: string;
  country?: string;
}

const REQUIRED_SIGNUP_FIELDS: ProfileFieldKey[] = ['full_name', 'email'];

function missingField(profile: UserAutofillProfile | null, field: ProfileFieldKey): boolean {
  if (!profile) return true;
  switch (field) {
    case 'full_name': return !profile.fullName;
    case 'email': return !profile.email;
    case 'phone': return !profile.phone;
    case 'company_name': return !profile.companyName;
    case 'billing_name': return !profile.billingName;
    case 'address_line1': return !profile.addressLine1;
    case 'address_line2': return !profile.addressLine2;
    case 'city': return !profile.city;
    case 'state_region': return !profile.stateRegion;
    case 'postal_code': return !profile.postalCode;
    case 'country': return !profile.country;
    default: return true;
  }
}

export function mapProfileToFormFill(input: {
  profile: UserAutofillProfile | null;
  required?: ProfileFieldKey[];
}): {
  fields: FormFillFieldMap;
  missingRequiredFields: ProfileFieldKey[];
} {
  const required = (input.required && input.required.length > 0)
    ? input.required
    : REQUIRED_SIGNUP_FIELDS;

  const fields: FormFillFieldMap = {
    fullName: input.profile?.fullName,
    email: input.profile?.email,
    phone: input.profile?.phone,
    companyName: input.profile?.companyName,
    billingName: input.profile?.billingName,
    addressLine1: input.profile?.addressLine1,
    addressLine2: input.profile?.addressLine2,
    city: input.profile?.city,
    stateRegion: input.profile?.stateRegion,
    postalCode: input.profile?.postalCode,
    country: input.profile?.country,
  };

  const missingRequiredFields = required.filter((field) => missingField(input.profile, field));

  return {
    fields,
    missingRequiredFields,
  };
}

export function labelForProfileField(field: ProfileFieldKey): string {
  return field.replace(/_/g, ' ');
}

