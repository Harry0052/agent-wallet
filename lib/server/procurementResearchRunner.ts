import { randomUUID } from 'node:crypto';
import type { ProcurementFinding, ProcurementTaskRecord } from '@/lib/types';
import { recordWebAction } from '@/lib/server/ledger';
import {
  createProcurementFinding,
  getProcurementTask,
  listProcurementFindings,
  updateProcurementTask,
} from '@/lib/server/procurement';
import { runTinyFishVendorPricingResearch } from '@/lib/server/tinyfishResearch';

function firstMeaningfulMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Unknown research error';
}

function uniqueVendors(findings: ProcurementFinding[]): string[] {
  return Array.from(new Set(findings.map((finding) => finding.vendorName))).sort();
}

function buildRecommendation(findings: ProcurementFinding[]): Record<string, unknown> | null {
  const candidates = findings.filter((finding) => finding.monthlyPrice !== null);

  if (candidates.length > 0) {
    const best = [...candidates].sort((a, b) => (a.monthlyPrice || 0) - (b.monthlyPrice || 0))[0];
    return {
      vendorName: best.vendorName,
      planName: best.planName,
      monthlyPrice: best.monthlyPrice,
      annualPrice: best.annualPrice,
      billingFrequency: best.billingFrequency,
      pricingPageUrl: best.pricingPageUrl,
      reason: 'Lowest observed monthly price from live TinyFish extraction.',
      extractedAt: best.extractionTimestamp,
    };
  }

  if (findings.length > 0) {
    const fallback = findings[0];
    return {
      vendorName: fallback.vendorName,
      planName: fallback.planName,
      monthlyPrice: fallback.monthlyPrice,
      annualPrice: fallback.annualPrice,
      billingFrequency: fallback.billingFrequency,
      pricingPageUrl: fallback.pricingPageUrl,
      reason: 'No monthly quotes found; first live extracted plan selected for review.',
      extractedAt: fallback.extractionTimestamp,
    };
  }

  return null;
}

async function appendLog(params: {
  userId: string;
  taskId: string;
  actionType: string;
  status: 'running' | 'done' | 'error';
  message: string;
  url?: string;
  phase?: string;
  event?: string;
  code?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await recordWebAction({
    userId: params.userId,
    taskId: params.taskId,
    actionType: params.actionType,
    url: params.url,
    status: params.status,
    details: {
      id: randomUUID(),
      phase: params.phase,
      event: params.event,
      code: params.code,
      message: params.message,
      ...params.details,
    },
  });
}

async function persistTaskUpdate(task: ProcurementTaskRecord, updates: {
  status: ProcurementTaskRecord['status'];
  findings?: Record<string, unknown> | null;
  recommendation?: Record<string, unknown> | null;
  error?: string;
}): Promise<ProcurementTaskRecord> {
  return updateProcurementTask({
    taskId: task.id,
    userId: task.userId,
    status: updates.status,
    goal: task.goal,
    budgetLimit: task.budgetLimit,
    category: task.category,
    targetVendors: task.targetVendors,
    comparisonCriteria: task.comparisonCriteria,
    mustHaveFeatures: task.mustHaveFeatures,
    findings: updates.findings,
    recommendation: updates.recommendation,
    planningOutput: task.planningOutput,
    error: updates.error,
  });
}

export async function runProcurementResearchTask(params: {
  userId: string;
  taskId: string;
}): Promise<void> {
  const task = await getProcurementTask({ taskId: params.taskId, userId: params.userId });
  if (!task) {
    throw new Error(`Procurement task not found: ${params.taskId}`);
  }

  if (task.status === 'needs_clarification') {
    throw new Error('Task requires clarification before live vendor research can run');
  }

  if (task.targetVendors.length === 0) {
    await persistTaskUpdate(task, {
      status: 'failed',
      findings: {
        vendorsRequested: 0,
        vendorsResearched: 0,
        plansCollected: 0,
      },
      recommendation: null,
      error: '[INVALID_STATE] No target vendors in planned task',
    });

    await appendLog({
      userId: task.userId,
      taskId: task.id,
      actionType: 'plan',
      status: 'error',
      phase: 'planning',
      event: 'research_blocked_no_targets',
      code: 'RESEARCH_BLOCKED_NO_TARGETS',
      message: 'research blocked: no target vendors were present in the planned task',
    });

    return;
  }

  await persistTaskUpdate(task, {
    status: 'researching',
    findings: task.findings,
    recommendation: task.recommendation,
    error: undefined,
  });

  await appendLog({
    userId: task.userId,
    taskId: task.id,
    actionType: 'plan',
    status: 'running',
    phase: 'researching',
    event: 'research_started',
    code: 'RESEARCH_STARTED',
    message: `starting live vendor research across ${task.targetVendors.length} vendor target(s)`,
  });

  const vendorErrors: string[] = [];

  for (const vendor of task.targetVendors) {
    await appendLog({
      userId: task.userId,
      taskId: task.id,
      actionType: 'visit',
      status: 'running',
      phase: 'researching',
      event: 'vendor_visit_started',
      code: 'VENDOR_VISIT_STARTED',
      message: `visiting ${vendor} pricing page`,
    });

    try {
      const research = await runTinyFishVendorPricingResearch({
        vendor,
        goal: task.goal,
        budgetLimit: task.budgetLimit,
        mustHaveFeatures: task.mustHaveFeatures,
        comparisonCriteria: task.comparisonCriteria,
        taskId: task.id,
      });

      const firstUrl = research.findings[0]?.pricingPageUrl;
      if (firstUrl) {
        await appendLog({
          userId: task.userId,
          taskId: task.id,
          actionType: 'visit',
          status: 'done',
          phase: 'researching',
          event: 'vendor_source_captured',
          code: 'VENDOR_SOURCE_CAPTURED',
          message: `captured pricing source for ${vendor}`,
          url: firstUrl,
        });
      }

      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'extract',
        status: 'running',
        phase: 'researching',
        event: 'monthly_toggle_started',
        code: 'MONTHLY_TOGGLE_STARTED',
        message: `switching to monthly billing where available for ${vendor}`,
      });

      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'extract',
        status: 'running',
        phase: 'researching',
        event: 'plan_extraction_started',
        code: 'PLAN_EXTRACTION_STARTED',
        message: `extracting plan names for ${vendor}`,
      });

      for (const step of research.steps) {
        await appendLog({
          userId: task.userId,
          taskId: task.id,
          actionType: step.type,
          status: step.status,
          phase: 'researching',
          event: 'tinyfish_step',
          code: 'TINYFISH_STEP',
          message: step.description,
          url: step.url,
        });
      }

      for (const finding of research.findings) {
        await createProcurementFinding({
          taskId: task.id,
          userId: task.userId,
          vendorName: finding.vendorName,
          pricingPageUrl: finding.pricingPageUrl,
          planName: finding.planName,
          monthlyPrice: finding.monthlyPrice,
          annualPrice: finding.annualPrice,
          billingFrequency: finding.billingFrequency,
          notableFeatures: finding.notableFeatures,
          extractionTimestamp: finding.extractionTimestamp,
          raw: finding.raw,
        });
      }

      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'extract',
        status: 'done',
        phase: 'researching',
        event: 'vendor_plans_found',
        code: 'VENDOR_PLANS_FOUND',
        message: `found ${research.findings.length} plan(s) for ${vendor}`,
      });

      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'compare',
        status: 'done',
        phase: 'researching',
        event: 'vendor_findings_stored',
        code: 'VENDOR_FINDINGS_STORED',
        message: `storing findings for ${vendor}`,
      });
    } catch (error) {
      const message = firstMeaningfulMessage(error);
      vendorErrors.push(`${vendor}: ${message}`);

      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'extract',
        status: 'error',
        phase: 'researching',
        event: 'vendor_research_failed',
        code: 'VENDOR_RESEARCH_FAILED',
        message: `research failed for ${vendor}: ${message}`,
      });
    }
  }

  const findings = await listProcurementFindings({ taskId: task.id, userId: task.userId });
  const recommendation = buildRecommendation(findings);

  const findingSummary: Record<string, unknown> = {
    vendorsRequested: task.targetVendors.length,
    vendorsResearched: uniqueVendors(findings).length,
    plansCollected: findings.length,
    vendorNames: uniqueVendors(findings),
    errors: vendorErrors,
    completedAt: new Date().toISOString(),
  };

  if (findings.length === 0) {
    await persistTaskUpdate(task, {
      status: 'failed',
      findings: findingSummary,
      recommendation: null,
      error: vendorErrors.length > 0
        ? `[TINYFISH_RESEARCH_FAILURE] No live findings collected. ${vendorErrors.join(' | ')}`
        : '[TINYFISH_RESEARCH_FAILURE] No live findings collected from TinyFish',
    });

    await appendLog({
      userId: task.userId,
      taskId: task.id,
      actionType: 'compare',
      status: 'error',
      phase: 'researching',
      event: 'research_completed_no_findings',
      code: 'RESEARCH_COMPLETED_NO_FINDINGS',
      message: 'research completed with zero live findings; task marked failed',
    });

    return;
  }

  await persistTaskUpdate(task, {
    status: 'researched',
    findings: findingSummary,
    recommendation,
    error: vendorErrors.length > 0 ? vendorErrors.join(' | ') : undefined,
  });

  await appendLog({
    userId: task.userId,
    taskId: task.id,
    actionType: 'compare',
    status: 'done',
    phase: 'researching',
    event: 'research_completed',
    code: 'RESEARCH_COMPLETED',
    message: `research complete: ${findings.length} live plan finding(s) stored`,
  });
}
