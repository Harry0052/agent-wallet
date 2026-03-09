import { routeAgentAction } from '@/lib/agent/router';
import { startLifecycle, transitionState } from '@/lib/agent/stateMachine';
import type { AgentRuntimeInput, AgentRuntimeResult, AgentTaskState } from '@/lib/agent/types';
import { orchestrateAgentMessage } from '@/lib/server/agentOrchestrator';
import { executeAgentTask } from '@/lib/agent/executor';

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

async function ensureClaudeAvailable() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) {
    throw new Error(
      'CLAUDE_REASONING_FAILURE: CLAUDE_API_KEY is not configured (set ANTHROPIC_API_KEY or CLAUDE_API_KEY)',
    );
  }
}

export async function runAgentRuntime(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
  let lifecycle = startLifecycle('Task received from user prompt.');

  try {
    await ensureClaudeAvailable();

    lifecycle = transitionState(
      lifecycle,
      'parsing',
      'Calling Claude intent parser and orchestration.',
    );

    const orchestration = await orchestrateAgentMessage({
      userId: input.userId,
      message: input.prompt,
    });

    lifecycle = transitionState(
      lifecycle,
      'ready_to_execute',
      `Intent detected: ${orchestration.intent.intent}`,
    );

    const routeDecision = routeAgentAction(orchestration);

    let executionResult: AgentRuntimeResult['executionResult'] = null;

    if (routeDecision.nextState === 'executing') {
      lifecycle = transitionState(
        lifecycle,
        'executing',
        `Executing tool route: ${routeDecision.toolRoute}`,
      );

      executionResult = await executeAgentTask({
        userId: input.userId,
        routeDecision,
        orchestration,
      });

      if (executionResult.status === 'failed') {
        lifecycle = transitionState(
          lifecycle,
          'failed',
          executionResult.message || `Execution failed for ${routeDecision.toolRoute}`,
        );
      } else {
        lifecycle = transitionState(
          lifecycle,
          'completed',
          executionResult.message || `Execution completed for ${routeDecision.toolRoute}`,
        );
      }
    } else {
      lifecycle = appendLifecycleForTarget(
        lifecycle,
        routeDecision.nextState,
        routeDecision.note,
      );
    }

    return {
      ...orchestration,
      intent: orchestration.intent,
      taskState: lifecycle[lifecycle.length - 1].state,
      toolRoute: routeDecision.toolRoute,
      executionResult,
      lifecycle,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown runtime failure';

    lifecycle = transitionState(
      lifecycle,
      'failed',
      `Runtime failure: ${errorMessage}`,
    );

    throw error;
  }
}
