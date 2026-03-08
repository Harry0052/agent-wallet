import { routeAgentAction } from '@/lib/agent/router';
import { startLifecycle, transitionState } from '@/lib/agent/stateMachine';
import type { AgentRuntimeInput, AgentRuntimeResult, AgentTaskState } from '@/lib/agent/types';
import { orchestrateAgentMessage } from '@/lib/server/agentOrchestrator';

function appendLifecycleForTarget(
  lifecycle: AgentRuntimeResult['lifecycle'],
  targetState: AgentTaskState,
  note: string,
): AgentRuntimeResult['lifecycle'] {
  let next = lifecycle;

  if (targetState === 'needs_clarification' || targetState === 'failed') {
    return transitionState(next, targetState, note);
  }

  next = transitionState(next, 'ready_to_execute', 'Intent parsed and workflow is executable.');

  if (targetState === 'awaiting_approval') {
    return transitionState(next, 'awaiting_approval', note);
  }

  if (targetState === 'executing') {
    return transitionState(next, 'executing', note);
  }

  next = transitionState(next, 'executing', 'Executing route action.');
  return transitionState(next, 'completed', note);
}

export async function runAgentRuntime(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
  let lifecycle = startLifecycle('Task received from user prompt.');
  lifecycle = transitionState(lifecycle, 'parsing', 'Calling Claude intent parser and orchestration.');

  try {
    const orchestration = await orchestrateAgentMessage({
      userId: input.userId,
      message: input.prompt,
    });
    const routeDecision = routeAgentAction(orchestration);
    lifecycle = appendLifecycleForTarget(lifecycle, routeDecision.nextState, routeDecision.note);

    return {
      ...orchestration,
      intent: orchestration.intent,
      taskState: lifecycle[lifecycle.length - 1].state,
      toolRoute: routeDecision.toolRoute,
      lifecycle,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown runtime failure';
    lifecycle = transitionState(lifecycle, 'failed', `Runtime failure: ${errorMessage}`);
    throw error;
  }
}

