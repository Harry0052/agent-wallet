import 'server-only';

import { randomUUID } from 'node:crypto';
import { query } from '@/lib/server/db';
import { ENGINE_VERSION, RULES_VERSION } from '@/lib/server/engines/contracts';
import {
  evaluateGovernor,
} from '@/lib/server/engines/taskGovernor';
import { logTaskRun } from '@/lib/server/engines/snapshotStore';
import { recordEngineMetric } from '@/lib/server/engines/engineMetrics';

export type FinancialTaskType =
  | 'cancel_subscription'
  | 'review_charge'
  | 'reduce_spending'
  | 'fund_wallet'
  | 'move_to_savings'
  | 'reconnect_account';

export interface FinancialTask {
  id: string;
  taskType: FinancialTaskType;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimatedImpact: number;
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed' | 'snoozed';
  snoozedUntil?: string;
  relatedEntityId?: string;
  sourceInsightId?: string;
  dedupKey: string;
  actionHref: string;
  automatable: boolean;
  confidence: number;
  engineVersion: string;
  rulesVersion: string;
  explanation: string;
  contributingFactors: Array<{ factor: string; weight: number; value: string }>;
}

export interface TaskGenerationResult {
  tasksCreated: number;
  tasksSuppressed: number;
  suppressionReasons: Array<{ taskType: string; reason: string }>;
  latencyMs: number;
  engineVersion: string;
  rulesVersion: string;
}

interface InsightRow {
  id: string;
  insight_type: string;
  title: string;
  summary: string;
  detail: Record<string, unknown>;
  severity: string;
  related_merchant: string | null;
  amount_impact: string | null;
}

interface HealthRow {
  savings_score: string | null;
}

interface StaleAccountRow {
  id: string;
  last_synced_at: string | null;
}

interface TaskCandidate {
  taskType: FinancialTaskType;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimatedImpact: number;
  relatedEntityId?: string;
  sourceInsightId?: string;
  dedupKey: string;
  actionHref: string;
  automatable: boolean;
  confidence: number;
  explanation: string;
  contributingFactors: Array<{ factor: string; weight: number; value: string }>;
}

export async function generateTasks(
  userId: string,
): Promise<TaskGenerationResult> {
  const startMs = Date.now();

  const insightResult = await query<InsightRow>(
    `SELECT id, insight_type, title, summary, detail, severity,
            related_merchant, amount_impact::text
     FROM insights
     WHERE user_id = $1 AND status = 'active'
     ORDER BY generated_at DESC
     LIMIT 100`,
    [userId],
  );

  const insights = insightResult.rows;
  const candidates: TaskCandidate[] = [];

  for (const insight of insights) {
    const detail = insight.detail || {};
    const impact = insight.amount_impact ? Number(insight.amount_impact) : 0;

    switch (insight.insight_type) {
      case 'waste': {
        const monthlyCost = Number(detail.monthlyCost) || impact;
        candidates.push({
          taskType: 'cancel_subscription',
          title: `Cancel ${insight.related_merchant || 'unused subscription'}`,
          description: insight.summary,
          priority: monthlyCost > 50 ? 'high' : 'medium',
          estimatedImpact: monthlyCost * 12,
          relatedEntityId: insight.related_merchant || undefined,
          sourceInsightId: insight.id,
          dedupKey: `${userId}:task:cancel:${insight.related_merchant || insight.id}:${RULES_VERSION}`,
          actionHref: '/subscriptions',
          automatable: false,
          confidence: Number(detail.confidence) || 0.7,
          explanation: `Subscription to ${insight.related_merchant || 'service'} appears unused or overpriced.`,
          contributingFactors: [
            { factor: 'monthly_cost', weight: 0.6, value: `$${monthlyCost.toFixed(2)}` },
            { factor: 'usage_signal', weight: 0.4, value: String(detail.reason || 'low activity') },
          ],
        });
        break;
      }

      case 'unusual_spending': {
        const amount = Number(detail.amount) || impact;
        candidates.push({
          taskType: 'review_charge',
          title: `Review charge at ${insight.related_merchant || 'merchant'}`,
          description: insight.summary,
          priority: amount > 200 ? 'high' : 'medium',
          estimatedImpact: amount,
          relatedEntityId: insight.related_merchant || undefined,
          sourceInsightId: insight.id,
          dedupKey: `${userId}:task:review:${insight.related_merchant || insight.id}:${detail.occurredAt || 'unknown'}:${RULES_VERSION}`,
          actionHref: '/transactions',
          automatable: false,
          confidence: Number(detail.confidence) || 0.7,
          explanation: `Charge of $${amount.toFixed(2)} at ${insight.related_merchant || 'merchant'} is unusually high.`,
          contributingFactors: [
            { factor: 'charge_amount', weight: 0.5, value: `$${amount.toFixed(2)}` },
            { factor: 'anomaly_confidence', weight: 0.5, value: String(detail.confidence || 0.7) },
          ],
        });
        break;
      }

      case 'budget_risk': {
        candidates.push({
          taskType: 'reduce_spending',
          title: 'Reduce spending to stay on budget',
          description: insight.summary,
          priority: 'high',
          estimatedImpact: impact,
          sourceInsightId: insight.id,
          dedupKey: `${userId}:task:reduce_spending:${insight.id}:${RULES_VERSION}`,
          actionHref: '/budgets',
          automatable: false,
          confidence: 0.8,
          explanation: 'Spending is trending above budget targets.',
          contributingFactors: [
            { factor: 'budget_overage', weight: 1.0, value: `$${impact.toFixed(2)}` },
          ],
        });

        candidates.push({
          taskType: 'fund_wallet',
          title: 'Add funds to cover upcoming expenses',
          description: 'Consider adding funds to your wallet to cover projected shortfall.',
          priority: 'high',
          estimatedImpact: impact,
          sourceInsightId: insight.id,
          dedupKey: `${userId}:task:fund_wallet:${insight.id}:${RULES_VERSION}`,
          actionHref: '/wallet',
          automatable: false,
          confidence: 0.75,
          explanation: 'Projected expenses may exceed current wallet balance.',
          contributingFactors: [
            { factor: 'projected_shortfall', weight: 1.0, value: `$${impact.toFixed(2)}` },
          ],
        });
        break;
      }

      default:
        break;
    }
  }

  const healthResult = await query<HealthRow>(
    `SELECT savings_score::text
     FROM health_score_snapshots
     WHERE user_id = $1
     ORDER BY generated_at DESC
     LIMIT 1`,
    [userId],
  );

  if (healthResult.rows.length > 0) {
    const savingsScore = Number(healthResult.rows[0].savings_score);
    if (Number.isFinite(savingsScore) && savingsScore < 50) {
      candidates.push({
        taskType: 'move_to_savings',
        title: 'Move money to savings',
        description: `Your savings score is ${savingsScore.toFixed(0)}. Consider moving funds to a savings account.`,
        priority: 'medium',
        estimatedImpact: 0,
        dedupKey: `${userId}:task:move_to_savings:low_score:${RULES_VERSION}`,
        actionHref: '/wallet',
        automatable: false,
        confidence: 0.7,
        explanation: `Savings health score is below target at ${savingsScore.toFixed(0)}/100.`,
        contributingFactors: [
          { factor: 'savings_score', weight: 1.0, value: `${savingsScore.toFixed(0)}/100` },
        ],
      });
    }
  }

  const staleThresholdMs = 48 * 60 * 60 * 1000;
  const staleResult = await query<StaleAccountRow>(
    `SELECT id, last_synced_at::text
     FROM financial_connector_accounts
     WHERE user_id = $1`,
    [userId],
  );

  for (const account of staleResult.rows) {
    if (!account.last_synced_at) continue;
    const syncedAt = Date.parse(account.last_synced_at);
    if (!Number.isFinite(syncedAt)) continue;
    if (Date.now() - syncedAt <= staleThresholdMs) continue;

    candidates.push({
      taskType: 'reconnect_account',
      title: 'Reconnect stale bank account',
      description: 'One of your linked accounts has not synced recently. Reconnect to keep your data fresh.',
      priority: 'low',
      estimatedImpact: 0,
      relatedEntityId: account.id,
      dedupKey: `${userId}:task:reconnect:${account.id}:${RULES_VERSION}`,
      actionHref: '/connect',
      automatable: false,
      confidence: 0.9,
      explanation: 'Account has not synced in over 48 hours.',
      contributingFactors: [
        { factor: 'sync_age_hours', weight: 1.0, value: String(Math.round((Date.now() - syncedAt) / (60 * 60 * 1000))) },
      ],
    });
  }

  let tasksCreated = 0;
  let tasksSuppressed = 0;
  const suppressionReasons: Array<{ taskType: string; reason: string }> = [];

  for (const candidate of candidates) {
    const decision = await evaluateGovernor({
      userId,
      taskType: candidate.taskType,
      relatedEntityId: candidate.relatedEntityId,
      confidence: candidate.confidence,
    });

    if (!decision.allowed) {
      tasksSuppressed += 1;
      suppressionReasons.push({
        taskType: candidate.taskType,
        reason: decision.reason,
      });
      continue;
    }

    const id = randomUUID();
    await query(
      `INSERT INTO agent_tasks (
        id, user_id, task_type, intent, status, input,
        engine_version, rules_version
      ) VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, $7)`,
      [
        id,
        userId,
        candidate.taskType,
        candidate.title,
        JSON.stringify({
          description: candidate.description,
          priority: candidate.priority,
          estimatedImpact: candidate.estimatedImpact,
          relatedEntityId: candidate.relatedEntityId,
          sourceInsightId: candidate.sourceInsightId,
          dedupKey: candidate.dedupKey,
          actionHref: candidate.actionHref,
          automatable: candidate.automatable,
          confidence: candidate.confidence,
          explanation: candidate.explanation,
          contributingFactors: candidate.contributingFactors,
        }),
        ENGINE_VERSION,
        RULES_VERSION,
      ],
    );

    tasksCreated += 1;
  }

  const latencyMs = Date.now() - startMs;

  await logTaskRun(userId, {
    tasksGenerated: tasksCreated,
    tasksSuppressed,
    latencyMs,
  });

  recordEngineMetric({
    engine: 'task',
    event: 'generation.complete',
    userId,
    latencyMs,
    count: tasksCreated,
  });

  return {
    tasksCreated,
    tasksSuppressed,
    suppressionReasons,
    latencyMs,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
  };
}

export async function updateTaskStatus(input: {
  userId: string;
  taskId: string;
  status: 'completed' | 'dismissed' | 'snoozed';
  snoozedUntil?: string;
}): Promise<void> {
  const { userId, taskId, status, snoozedUntil } = input;

  if (status === 'snoozed' && snoozedUntil) {
    await query(
      `UPDATE agent_tasks
       SET status = $1, snoozed_until = $2::timestamptz, updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      [status, snoozedUntil, taskId, userId],
    );
  } else {
    await query(
      `UPDATE agent_tasks
       SET status = $1, snoozed_until = NULL, updated_at = NOW()
       WHERE id = $2 AND user_id = $3`,
      [status, taskId, userId],
    );
  }
}

export { listSurfacedTasks } from '@/lib/server/engines/taskGovernor';
