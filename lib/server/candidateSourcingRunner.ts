import 'server-only';
import { normalizeSourcingRequest } from '@/lib/sourcing/normalize';
import { exportShortlistToGoogleSheets } from '@/lib/sourcing/googleSheets';
import { runSourcingWorkflow, type SourcingExporter, type SourcingPassExecutor } from '@/lib/sourcing/workflow';
import { runIndeedCandidateSourcingPass } from '@/lib/server/tinyfishCandidateSourcing';
import {
  getCandidateSourcingTaskById,
  logCandidateSourcingAction,
  updateCandidateSourcingTask,
} from '@/lib/server/sourcingTaskStore';
import { logServerEvent } from '@/lib/server/observability';

function extractPrompt(input: Record<string, unknown> | null, fallbackIntent: string): string {
  if (!input) return fallbackIntent;

  const candidates = [
    input.normalized_goal,
    input.description,
    input.originalPrompt,
    input.goal,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return fallbackIntent;
}

function phaseToStatus(phase: string): 'running' | 'parsing' | 'scoring' | 'exporting' | null {
  if (phase === 'planning') return 'running';
  if (phase === 'parsing') return 'parsing';
  if (phase === 'scoring') return 'scoring';
  if (phase === 'exporting') return 'exporting';
  return null;
}

export interface CandidateSourcingRunResult {
  started: boolean;
  taskId: string;
  status: 'queued' | 'running' | 'parsing' | 'scoring' | 'exporting' | 'completed' | 'partial_success' | 'failed';
  message: string;
}

export interface CandidateSourcingRunnerDeps {
  passExecutor?: SourcingPassExecutor;
  exporter?: SourcingExporter;
}

export async function executeCandidateSourcingTask(params: {
  userId: string;
  taskId: string;
}, deps?: CandidateSourcingRunnerDeps): Promise<void> {
  const task = await getCandidateSourcingTaskById({
    userId: params.userId,
    taskId: params.taskId,
  });

  if (!task) {
    throw new Error(`Candidate sourcing task not found: ${params.taskId}`);
  }

  const prompt = extractPrompt(task.input, task.intent);
  const normalized = normalizeSourcingRequest(prompt);

  await updateCandidateSourcingTask({
    userId: params.userId,
    taskId: params.taskId,
    status: 'running',
    resultPatch: {
      workflow: {
        status: 'running',
        startedAt: new Date().toISOString(),
      },
      normalizedRequest: normalized,
    },
    error: null,
  });

  await logCandidateSourcingAction({
    userId: params.userId,
    taskId: params.taskId,
    actionType: 'queued',
    status: 'running',
    message: 'Candidate sourcing task started.',
  });

  const passExecutor = deps?.passExecutor || {
    runPass: runIndeedCandidateSourcingPass,
  };

  const exporter = deps?.exporter || {
    exportShortlist: exportShortlistToGoogleSheets,
  };

  const workflowResult = await runSourcingWorkflow({
    taskId: params.taskId,
    request: normalized,
  }, {
    passExecutor,
    exporter,
    onActionLog: (() => {
      let lastPersistedStatus: ReturnType<typeof phaseToStatus> = 'running';
      return (entry) => {
        const nextStatus = phaseToStatus(entry.phase);
        if (nextStatus && nextStatus !== lastPersistedStatus) {
          lastPersistedStatus = nextStatus;
          void updateCandidateSourcingTask({
            userId: params.userId,
            taskId: params.taskId,
            status: nextStatus,
            resultPatch: {
              workflow: {
                status: nextStatus,
                updatedAt: entry.at,
                lastMessage: entry.message,
              },
            },
            error: null,
          }).catch(() => undefined);
        }

        void logCandidateSourcingAction({
          userId: params.userId,
          taskId: params.taskId,
          actionType: entry.phase,
          status: entry.phase === 'failed' ? 'error' : 'done',
          message: entry.message,
          details: entry.stats,
        }).catch(() => undefined);
      };
    })(),
  });

  await updateCandidateSourcingTask({
    userId: params.userId,
    taskId: params.taskId,
    status: workflowResult.status,
    resultPatch: workflowResult as unknown as Record<string, unknown>,
    error: workflowResult.status === 'failed'
      ? workflowResult.errors.map((item) => item.message).join(' | ').slice(0, 1200)
      : null,
  });

  await logCandidateSourcingAction({
    userId: params.userId,
    taskId: params.taskId,
    actionType: 'completed',
    status: workflowResult.status === 'failed' ? 'error' : 'done',
    message: workflowResult.summary,
    details: {
      finalStatus: workflowResult.status,
      shortlistCount: workflowResult.shortlist.length,
      sheetUrl: workflowResult.export.sheetUrl,
    },
  });

  logServerEvent('info', 'candidate_sourcing.completed', {
    userId: params.userId,
    taskId: params.taskId,
    status: workflowResult.status,
    shortlistCount: workflowResult.shortlist.length,
    sheetUrl: workflowResult.export.sheetUrl,
  });
}

export async function startCandidateSourcingTask(params: {
  userId: string;
  taskId: string;
}, deps?: CandidateSourcingRunnerDeps): Promise<CandidateSourcingRunResult> {
  const task = await getCandidateSourcingTaskById({
    userId: params.userId,
    taskId: params.taskId,
  });

  if (!task) {
    throw new Error(`Candidate sourcing task not found: ${params.taskId}`);
  }

  if (task.status === 'running' || task.status === 'parsing' || task.status === 'scoring' || task.status === 'exporting') {
    return {
      started: false,
      taskId: task.id,
      status: task.status,
      message: 'Candidate sourcing task is already running.',
    };
  }

  if (task.status === 'completed' || task.status === 'partial_success') {
    return {
      started: false,
      taskId: task.id,
      status: task.status,
      message: 'Candidate sourcing task already completed.',
    };
  }

  await updateCandidateSourcingTask({
    userId: params.userId,
    taskId: params.taskId,
    status: 'queued',
    resultPatch: {
      workflow: {
        status: 'queued',
        queuedAt: new Date().toISOString(),
      },
    },
    error: null,
  });

  void executeCandidateSourcingTask(params, deps).catch(async (error) => {
    const message = error instanceof Error ? error.message : 'Candidate sourcing run failed';

    await updateCandidateSourcingTask({
      userId: params.userId,
      taskId: params.taskId,
      status: 'failed',
      resultPatch: {
        workflow: {
          status: 'failed',
          failedAt: new Date().toISOString(),
        },
      },
      error: message,
    }).catch(() => undefined);

    await logCandidateSourcingAction({
      userId: params.userId,
      taskId: params.taskId,
      actionType: 'failed',
      status: 'error',
      message,
    }).catch(() => undefined);

    logServerEvent('error', 'candidate_sourcing.failed', {
      userId: params.userId,
      taskId: params.taskId,
      message,
    });
  });

  return {
    started: true,
    taskId: params.taskId,
    status: 'queued',
    message: 'Candidate sourcing task queued.',
  };
}
