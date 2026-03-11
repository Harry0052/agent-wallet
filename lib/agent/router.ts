import type { AgentToolRoute, AgentTaskState } from '@/lib/agent/types';
import type { AgentOrchestrationResult } from '@/lib/server/agentOrchestrator';

export interface AgentRouteDecision {
  toolRoute: AgentToolRoute;
  nextState: AgentTaskState;
  note: string;
}

export function routeAgentAction(orchestration: AgentOrchestrationResult): AgentRouteDecision {
  if (orchestration.status === 'awaiting_clarification') {
    return {
      toolRoute: 'ask_clarification',
      nextState: 'needs_clarification',
      note: orchestration.message || 'Clarification is required before I can continue.',
    };
  }

  if (orchestration.status === 'blocked') {
    return {
      toolRoute: 'reason',
      nextState: 'failed',
      note: 'Policy or safety checks blocked execution.',
    };
  }

  if (orchestration.status === 'awaiting_approval') {
    return {
      toolRoute: 'reason',
      nextState: 'awaiting_approval',
      note: 'Awaiting explicit user approval before execution.',
    };
  }

  if (orchestration.route === 'fund_wallet' || orchestration.route === 'send_money_approval') {
    return {
      toolRoute: 'stripe_wallet',
      nextState: 'executing',
      note: 'Routing to Stripe/wallet flow.',
    };
  }

  if (
    orchestration.route === 'procurement_task'
    || orchestration.route === 'candidate_sourcing_task'
    || orchestration.route === 'signup_and_prepare_checkout'
    || orchestration.route === 'cancel_subscription'
  ) {
    return {
      toolRoute: 'tinyfish',
      nextState: 'executing',
      note: 'Routing to TinyFish for live browser execution.',
    };
  }

  if (orchestration.route === 'review_spend') {
    return {
      toolRoute: 'database_query',
      nextState: 'completed',
      note: 'Spend review resolved from ledger and wallet records.',
    };
  }

  return {
    toolRoute: 'reason',
    nextState: 'failed',
    note: 'No valid execution route resolved.',
  };
}
