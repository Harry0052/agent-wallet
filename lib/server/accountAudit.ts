import 'server-only';

import { randomUUID } from 'node:crypto';
import { query } from '@/lib/server/db';

export async function recordAccountAuditEvent(input: {
  userId?: string | null;
  action: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await query(
    `
      INSERT INTO app_account_audit_events (
        id,
        user_id,
        action,
        ip,
        user_agent,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
    `,
    [
      randomUUID(),
      input.userId || null,
      input.action,
      input.ip || null,
      input.userAgent || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}
