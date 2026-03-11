import { z } from 'zod';

export const SupportWorkflowStateSchema = z.enum([
  'RECEIVED',
  'FAILURE_CLASSIFIED',
  'EVIDENCE_COLLECTED',
  'ACTION_DECIDED',
  'RESPONSES_GENERATED',
  'ACTION_EXECUTED',
  'COMPLETED',
  'FAILED',
]);

export type SupportWorkflowState = z.infer<typeof SupportWorkflowStateSchema>;

export const SupportWorkflowTransitionSchema = z.object({
  from: SupportWorkflowStateSchema,
  to: SupportWorkflowStateSchema,
  at: z.string().datetime({ offset: true }),
  reason: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export type SupportWorkflowTransition = z.infer<typeof SupportWorkflowTransitionSchema>;

export const SupportWorkflowSnapshotSchema = z.object({
  state: SupportWorkflowStateSchema,
  history: z.array(SupportWorkflowTransitionSchema),
});

export type SupportWorkflowSnapshot = z.infer<typeof SupportWorkflowSnapshotSchema>;

const TRANSITIONS: Record<SupportWorkflowState, SupportWorkflowState[]> = {
  RECEIVED: ['FAILURE_CLASSIFIED', 'FAILED'],
  FAILURE_CLASSIFIED: ['EVIDENCE_COLLECTED', 'FAILED'],
  EVIDENCE_COLLECTED: ['ACTION_DECIDED', 'FAILED'],
  ACTION_DECIDED: ['RESPONSES_GENERATED', 'FAILED'],
  RESPONSES_GENERATED: ['ACTION_EXECUTED', 'COMPLETED', 'FAILED'],
  ACTION_EXECUTED: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export function createSupportWorkflowSnapshot(): SupportWorkflowSnapshot {
  return {
    state: 'RECEIVED',
    history: [],
  };
}

export function canTransition(
  from: SupportWorkflowState,
  to: SupportWorkflowState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function applySupportWorkflowTransition(
  snapshot: SupportWorkflowSnapshot,
  to: SupportWorkflowState,
  reason: string,
  metadata?: Record<string, unknown>,
): SupportWorkflowSnapshot {
  if (!canTransition(snapshot.state, to)) {
    throw new Error(`Invalid support workflow transition ${snapshot.state} -> ${to}`);
  }

  const transition: SupportWorkflowTransition = SupportWorkflowTransitionSchema.parse({
    from: snapshot.state,
    to,
    at: new Date().toISOString(),
    reason,
    metadata,
  });

  return SupportWorkflowSnapshotSchema.parse({
    state: to,
    history: [...snapshot.history, transition],
  });
}
