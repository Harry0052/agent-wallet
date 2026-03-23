import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { query } from '@/lib/server/db';
import { logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-side transaction summary aggregation.
 *
 * Returns income/expenses/net/savings_rate/top_categories for a given
 * time range, computed entirely in SQL. The client never needs to
 * iterate raw transactions for summary cards.
 *
 * Query params:
 *   ?days=30   (default 30, max 365)
 */
export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'statement_summary' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const daysParam = req.nextUrl.searchParams.get('days');
    const days = Math.min(Math.max(Number(daysParam) || 30, 1), 365);

    // Single query: income, expenses, top categories — all in SQL
    const [totalsResult, categoriesResult] = await Promise.all([
      query<{ income: string; expenses: string }>(
        `SELECT
          COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)::text AS income,
          COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::text AS expenses
        FROM transactions
        WHERE user_id = $1
          AND pending = FALSE
          AND occurred_at >= (NOW() - ($2 || ' days')::interval)`,
        [userId, String(days)],
      ),
      query<{ category: string; amount: string; percent: string }>(
        `WITH cat_totals AS (
          SELECT
            COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS category,
            SUM(ABS(amount)) AS amount
          FROM transactions
          WHERE user_id = $1
            AND pending = FALSE
            AND amount < 0
            AND occurred_at >= (NOW() - ($2 || ' days')::interval)
          GROUP BY 1
          ORDER BY amount DESC
          LIMIT 8
        ),
        grand AS (
          SELECT SUM(amount) AS total FROM cat_totals
        )
        SELECT
          ct.category,
          ct.amount::text,
          CASE WHEN g.total > 0
            THEN ROUND((ct.amount / g.total) * 100)::text
            ELSE '0'
          END AS percent
        FROM cat_totals ct, grand g
        ORDER BY ct.amount DESC`,
        [userId, String(days)],
      ),
    ]);

    const income = Number(totalsResult.rows[0]?.income || '0');
    const expenses = Number(totalsResult.rows[0]?.expenses || '0');
    const net = income - expenses;
    const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;

    return NextResponse.json({
      ok: true,
      summary: {
        days,
        income: Math.round(income * 100) / 100,
        expenses: Math.round(expenses * 100) / 100,
        net: Math.round(net * 100) / 100,
        savingsRate,
        topCategories: categoriesResult.rows.map((r) => ({
          category: r.category,
          amount: Math.round(Number(r.amount) * 100) / 100,
          percent: Number(r.percent),
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute summary';
    logServerEvent('error', 'statements.summary.failed', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
