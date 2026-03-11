export interface ReferralProgramData {
  code: string;
  shareUrl: string;
  status: string;
  rewardText: string;
  inviteMessage: string;
}

function toError(body: { error?: string }): Error {
  return new Error(body.error || 'Referral request failed');
}

export async function fetchReferralProgram(): Promise<ReferralProgramData> {
  const response = await fetch('/api/referrals', {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    ok?: boolean;
    referral?: ReferralProgramData;
    error?: string;
  };

  if (!response.ok || !body.ok || !body.referral) {
    throw toError(body);
  }

  return body.referral;
}
