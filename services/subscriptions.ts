// --- Local type definitions (previously in @/lib/types) ---

type SubscriptionOperationType =
  | 'inspect_billing'
  | 'renewal_check'
  | 'downgrade'
  | 'cancel'
  | 'switch_billing';

type SubscriptionOperationStatus = 'running' | 'completed' | 'blocked' | 'failed';

interface ActiveSubscriptionTask {
  taskId: string;
  title: string;
  vendorName: string;
  planName: string;
  amount: number | null;
  amountBasis: 'monthly' | 'annual' | 'unknown';
  billingFrequency: string;
  sourceUrl: string;
  approvedAt?: string;
  taskStatus: string;
}

interface SubscriptionActionRecord {
  id: string;
  userId: string;
  taskId: string;
  operation: SubscriptionOperationType;
  status: SubscriptionOperationStatus;
  summary?: string;
  evidenceUrls: string[];
  projectedSavings: number | null;
  projectedSavingsBasis: 'monthly' | 'annual' | 'unknown';
  currency: string | null;
  renewalDate?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProcurementResearchLog {
  id: string;
  taskId: string;
  actionType: string;
  status: 'running' | 'done' | 'error';
  message: string;
  url?: string;
  phase?: string;
  event?: string;
  code?: string;
  createdAt: string;
}

interface ProcurementLifecycleState {
  phase: 'planning' | 'researching' | 'comparing' | 'approval' | 'purchase_prep' | 'subscription_ops' | 'failed';
  canRetry: boolean;
  retryHint?: string;
}

export interface SubscriptionStatusResponse {
  activeSubscriptions: ActiveSubscriptionTask[];
  actions: SubscriptionActionRecord[];
  logs: ProcurementResearchLog[];
  selectedTaskId?: string;
  lifecycle?: ProcurementLifecycleState;
  serverTime: string;
}

function formatApiError(body: { error?: string; errorCode?: string }): string {
  if (body.errorCode && body.error) return `${body.errorCode}: ${body.error}`;
  return body.error || 'Request failed';
}

export async function fetchSubscriptionStatus(taskId?: string): Promise<SubscriptionStatusResponse> {
  const params = new URLSearchParams();
  if (taskId) params.set('taskId', taskId);

  const response = await fetch(`/api/subscriptions/status${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    ok?: boolean;
    activeSubscriptions?: ActiveSubscriptionTask[];
    actions?: SubscriptionActionRecord[];
    logs?: ProcurementResearchLog[];
    selectedTaskId?: string;
    lifecycle?: ProcurementLifecycleState;
    serverTime?: string;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (!Array.isArray(body.activeSubscriptions) || !Array.isArray(body.actions) || !Array.isArray(body.logs) || !body.serverTime) {
    throw new Error('Subscription status response is incomplete');
  }

  return {
    activeSubscriptions: body.activeSubscriptions,
    actions: body.actions,
    logs: body.logs,
    selectedTaskId: body.selectedTaskId,
    lifecycle: body.lifecycle,
    serverTime: body.serverTime,
  };
}

export async function runSubscriptionOperation(input: {
  taskId: string;
  operation: SubscriptionOperationType;
}): Promise<{
  action: SubscriptionActionRecord;
  started: boolean;
  taskId: string;
}> {
  const response = await fetch('/api/subscriptions/operate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    started?: boolean;
    action?: SubscriptionActionRecord;
    taskId?: string;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (!body.action || typeof body.started !== 'boolean' || !body.taskId) {
    throw new Error('Subscription operation response is incomplete');
  }

  return {
    action: body.action,
    started: body.started,
    taskId: body.taskId,
  };
}
