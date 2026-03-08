export interface FundingSession {
  checkoutUrl: string;
  sessionId: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || 'Request failed');
  }
  return body as T;
}

export async function createFundingSession(amount: number): Promise<FundingSession> {
  const res = await fetch('/api/funding/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });

  return jsonOrThrow<FundingSession>(res);
}
