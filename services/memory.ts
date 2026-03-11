import type { SessionSnapshot } from '@/lib/types';

/**
 * Load persisted session snapshot from the server.
 */
export async function loadSession(): Promise<SessionSnapshot> {
  const res = await fetch('/api/memory');
  if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);
  return res.json();
}

/**
 * Save partial session snapshot to the server.
 * Fire-and-forget: errors are logged but not thrown.
 */
export async function saveSession(
  partial: Partial<SessionSnapshot>,
): Promise<void> {
  try {
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
  } catch (err) {
    console.error('[memory] save failed:', err);
  }
}
