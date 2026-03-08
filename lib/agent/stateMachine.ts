import type { AgentStateSnapshot, AgentTaskState } from '@/lib/agent/types';

const transitionMap: Record<AgentTaskState, Set<AgentTaskState>> = {
  received: new Set(['parsing', 'failed']),
  parsing: new Set(['needs_clarification', 'ready_to_execute', 'failed']),
  needs_clarification: new Set(['parsing', 'failed']),
  ready_to_execute: new Set(['executing', 'awaiting_approval', 'completed', 'failed']),
  executing: new Set(['awaiting_approval', 'completed', 'failed']),
  awaiting_approval: new Set(['executing', 'completed', 'failed']),
  completed: new Set([]),
  failed: new Set([]),
};

function snapshot(state: AgentTaskState, note: string): AgentStateSnapshot {
  return {
    state,
    at: new Date().toISOString(),
    note,
  };
}

export function startLifecycle(note: string): AgentStateSnapshot[] {
  return [snapshot('received', note)];
}

export function canTransition(from: AgentTaskState, to: AgentTaskState): boolean {
  return transitionMap[from].has(to);
}

export function transitionState(
  lifecycle: AgentStateSnapshot[],
  to: AgentTaskState,
  note: string,
): AgentStateSnapshot[] {
  const current = lifecycle[lifecycle.length - 1];
  if (!current) {
    throw new Error('Agent lifecycle is empty');
  }
  if (!canTransition(current.state, to)) {
    throw new Error(`Invalid agent state transition: ${current.state} -> ${to}`);
  }

  return [...lifecycle, snapshot(to, note)];
}

