import type { AgentIntent } from '@/lib/server/agentIntent';
import type { AgentOrchestrationResult } from '@/lib/server/agentOrchestrator';

export type AgentTaskState =
  | 'received'
  | 'parsing'
  | 'needs_clarification'
  | 'ready_to_execute'
  | 'executing'
  | 'awaiting_approval'
  | 'completed'
  | 'failed';

export type AgentToolRoute =
  | 'reason'
  | 'ask_clarification'
  | 'tinyfish'
  | 'stripe_wallet'
  | 'database_query';

export interface AgentExecutionResult {
  status: 'success' | 'failed' | 'queued' | 'noop' | 'pending_checkout' | 'needs_input';
  message?: string;
  [key: string]: unknown;
}

export interface AgentRuntimeInput {
  userId: string;
  prompt: string;
}

export interface AgentStateSnapshot {
  state: AgentTaskState;
  at: string;
  note: string;
}

export interface AgentRuntimeResult extends AgentOrchestrationResult {
  intent: AgentIntent;
  taskState: AgentTaskState;
  toolRoute: AgentToolRoute;
  executionResult: AgentExecutionResult | null;
  lifecycle: AgentStateSnapshot[];
}
