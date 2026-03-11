import { query } from '@/lib/server/db';
import { logServerEvent } from '@/lib/server/observability';
import type { ChatMessage, SessionSnapshot, MemoryKey } from '@/lib/types';

// ---------------------------------------------------------------------------
// agent_memory CRUD
// ---------------------------------------------------------------------------

interface MemoryEntry {
  key: MemoryKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

/**
 * Bulk upsert memory entries for a user.
 * Uses a single INSERT with multiple VALUES rows + ON CONFLICT DO UPDATE.
 */
export async function setMemoryBulk(userId: string, entries: MemoryEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  entries.forEach((entry, i) => {
    const offset = i * 3;
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
    values.push(userId, entry.key, JSON.stringify(entry.value));
  });

  await query(
    `INSERT INTO agent_memory (user_id, key, value)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (user_id, key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()`,
    values,
  );
}

/**
 * Get all memory entries matching a key prefix (e.g. 'session:').
 */
export async function getMemoryByPrefix(
  userId: string,
  prefix: string,
): Promise<{ key: string; value: unknown }[]> {
  const result = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM agent_memory WHERE user_id = $1 AND key LIKE $2`,
    [userId, `${prefix}%`],
  );
  return result.rows;
}

/**
 * Delete a single memory entry.
 */
export async function deleteMemory(userId: string, key: MemoryKey): Promise<void> {
  await query(`DELETE FROM agent_memory WHERE user_id = $1 AND key = $2`, [userId, key]);
}

// ---------------------------------------------------------------------------
// Session snapshot helpers
// ---------------------------------------------------------------------------

const MAX_PERSISTED_MESSAGES = 30;
const RECENT_WITH_DATA = 10;

/**
 * Prepare messages for persistence:
 * - Cap at 30 most recent
 * - Strip `data` from messages older than the most recent 10
 */
export function prepareMessagesForPersistence(messages: ChatMessage[]): ChatMessage[] {
  const capped = messages.slice(-MAX_PERSISTED_MESSAGES);
  const cutoff = capped.length - RECENT_WITH_DATA;

  return capped.map((msg, i) => {
    if (i < cutoff && msg.data) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { data, ...rest } = msg;
      return rest as ChatMessage;
    }
    return msg;
  });
}

/**
 * Load a session snapshot from the DB.
 */
export async function loadSessionSnapshot(userId: string): Promise<SessionSnapshot> {
  const rows = await getMemoryByPrefix(userId, 'session:');

  const snapshot: SessionSnapshot = {
    messages: [],
    activeTask: null,
    liveRun: null,
  };

  for (const row of rows) {
    switch (row.key) {
      case 'session:messages':
        snapshot.messages = row.value as ChatMessage[];
        break;
      case 'session:active_task':
        snapshot.activeTask = row.value as SessionSnapshot['activeTask'];
        break;
      case 'session:live_run':
        snapshot.liveRun = row.value as SessionSnapshot['liveRun'];
        break;
    }
  }

  return snapshot;
}

/**
 * Save a partial session snapshot to the DB.
 * Only provided fields are upserted; omitted fields are left unchanged.
 */
export async function saveSessionSnapshot(
  userId: string,
  partial: Partial<SessionSnapshot>,
): Promise<void> {
  const entries: MemoryEntry[] = [];

  if (partial.messages !== undefined) {
    entries.push({
      key: 'session:messages',
      value: prepareMessagesForPersistence(partial.messages),
    });
  }

  if (partial.activeTask !== undefined) {
    entries.push({ key: 'session:active_task', value: partial.activeTask });
  }

  if (partial.liveRun !== undefined) {
    entries.push({ key: 'session:live_run', value: partial.liveRun });
  }

  if (entries.length === 0) return;

  try {
    await setMemoryBulk(userId, entries);
  } catch (err) {
    logServerEvent('error', 'memory.save_session_snapshot_failed', {
      userId,
      keys: entries.map((e) => e.key),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
