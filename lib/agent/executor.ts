import type { AgentExecutionResult } from '@/lib/agent/types';
import type { AgentRouteDecision } from '@/lib/agent/router';
import type { AgentOrchestrationResult } from '@/lib/server/agentOrchestrator';
import { runTinyFishTask } from '@/lib/agent/tools/tinyfish';
import { executeStripeWalletTask } from '@/lib/agent/tools/sendMoney';

export async function executeAgentTask(params: {
  userId: string;
  routeDecision: AgentRouteDecision;
  orchestration: AgentOrchestrationResult;
}): Promise<AgentExecutionResult> {
  const { routeDecision, orchestration, userId } = params;

  switch (routeDecision.toolRoute) {
    case 'stripe_wallet':
      return executeStripeWalletTask({ userId, orchestration });

    case 'tinyfish':
      return runTinyFishTask({ userId, orchestration });

    default:
      return {
        status: 'noop',
        message: 'No executable action required for this route.',
      };
  }
}
