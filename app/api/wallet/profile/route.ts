import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import {
  getUserAutofillProfile,
  getWalletUserId,
  upsertUserAutofillProfile,
} from '@/lib/server/ledger';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(4).optional(),
  companyName: z.string().trim().min(1).optional(),
  billingName: z.string().trim().min(1).optional(),
  addressLine1: z.string().trim().min(1).optional(),
  addressLine2: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  stateRegion: z.string().trim().min(1).optional(),
  postalCode: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one profile field is required',
});

export async function GET() {
  try {
    const profile = await getUserAutofillProfile(await getWalletUserId());
    return NextResponse.json({ profile });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load profile' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const patch = PatchSchema.parse(await req.json());
    const profile = await upsertUserAutofillProfile(await getWalletUserId(), patch);
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((issue) => issue.message).join('; ') }, { status: 400 });
    }
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update profile' },
      { status: 500 },
    );
  }
}
