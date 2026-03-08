import type {
  ProcurementFinding,
  ProcurementLifecycleState,
  ProcurementPlan,
  ProcurementRecommendationRecord,
  ProcurementResearchLog,
  ProcurementTaskRecord,
  Wallet,
} from '@/lib/types';

export interface ProcurementPlanningResponse {
  task: ProcurementTaskRecord;
  planning: ProcurementPlan;
}

export interface ProcurementResearchStatusResponse {
  task: ProcurementTaskRecord;
  lifecycle: ProcurementLifecycleState;
  findings: ProcurementFinding[];
  logs: ProcurementResearchLog[];
  serverTime: string;
}

function formatApiError(body: { error?: string; errorCode?: string }): string {
  if (body.errorCode && body.error) return `${body.errorCode}: ${body.error}`;
  return body.error || 'Request failed';
}

export async function planProcurementTask(userMessage: string, wallet: Wallet): Promise<ProcurementPlanningResponse> {
  const response = await fetch('/api/procurement/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userMessage,
      wallet: {
        balance: wallet.balance,
        settings: wallet.settings,
      },
    }),
  });

  const body = (await response.json()) as {
    task?: ProcurementTaskRecord;
    planning?: ProcurementPlan;
    error?: string;
    errorCode?: string;
  };
  if (!response.ok) {
    throw new Error(formatApiError(body));
  }

  if (!body.task || !body.planning) {
    throw new Error('Procurement planning response is missing required fields');
  }

  return {
    task: body.task,
    planning: body.planning,
  };
}

export async function startProcurementResearch(taskId: string): Promise<void> {
  const response = await fetch('/api/procurement/research/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });

  const body = (await response.json()) as { ok?: boolean; error?: string; errorCode?: string };
  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }
}

export async function fetchProcurementResearchStatus(taskId: string, since?: string): Promise<ProcurementResearchStatusResponse> {
  const params = new URLSearchParams({ taskId });
  if (since) params.set('since', since);

  const response = await fetch(`/api/procurement/research/status?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    ok?: boolean;
    task?: ProcurementTaskRecord;
    lifecycle?: ProcurementLifecycleState;
    findings?: ProcurementFinding[];
    logs?: ProcurementResearchLog[];
    serverTime?: string;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (!body.task || !body.lifecycle || !Array.isArray(body.findings) || !Array.isArray(body.logs) || !body.serverTime) {
    throw new Error('Procurement research status response is incomplete');
  }

  return {
    task: body.task,
    lifecycle: body.lifecycle,
    findings: body.findings,
    logs: body.logs,
    serverTime: body.serverTime,
  };
}

export async function compareProcurementFindings(taskId: string): Promise<{
  task: ProcurementTaskRecord;
  recommendation: ProcurementRecommendationRecord;
}> {
  const response = await fetch('/api/procurement/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    task?: ProcurementTaskRecord;
    recommendation?: ProcurementRecommendationRecord;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (!body.task || !body.recommendation) {
    throw new Error('Procurement comparison response is incomplete');
  }

  return {
    task: body.task,
    recommendation: body.recommendation,
  };
}

export async function submitProcurementApproval(taskId: string, decision: 'approved' | 'rejected'): Promise<{
  task: ProcurementTaskRecord;
  recommendation: ProcurementRecommendationRecord;
  started: boolean;
}> {
  const response = await fetch('/api/procurement/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, decision }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    task?: ProcurementTaskRecord;
    recommendation?: ProcurementRecommendationRecord;
    started?: boolean;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (!body.task || !body.recommendation || typeof body.started !== 'boolean') {
    throw new Error('Procurement approval response is incomplete');
  }

  return {
    task: body.task,
    recommendation: body.recommendation,
    started: body.started,
  };
}
