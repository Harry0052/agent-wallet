import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { getAutomationAction } from '@/lib/server/automation/store';
import { createActionPlan } from '@/lib/server/automation/providers/actionPlanner';
import { isAuthError } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_TIMEOUT_MS = 90_000;

// ── SSE Helpers ──────────────────────────────────────────────────────────────

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ── Plan-based Simulation ────────────────────────────────────────────────────
// When TinyFish run-sse is not available, simulate progress from the action
// plan steps with realistic timing. This allows the UI to render progress
// during development and testing.

async function simulateFromPlan(
  controller: ReadableStreamDefaultController,
  action: {
    actionType: string;
    payload: Record<string, unknown>;
  },
  signal: AbortSignal,
): Promise<void> {
  const targetService =
    (action.payload?.merchant as string)
    || (action.payload?.targetService as string)
    || 'Unknown service';

  const plan = createActionPlan({
    actionType: action.actionType as Parameters<typeof createActionPlan>[0]['actionType'],
    targetService,
  });

  const totalSteps = plan.steps.length;
  const startTime = Date.now();

  for (let i = 0; i < totalSteps; i++) {
    if (signal.aborted) return;

    const step = plan.steps[i];
    const elapsed = Date.now() - startTime;

    // step_started
    controller.enqueue(
      new TextEncoder().encode(
        formatSSE({
          type: 'step_started',
          step: step.label,
          stepIndex: i + 1,
          totalSteps,
          site: targetService,
          elapsed,
        }),
      ),
    );

    // Simulate realistic step duration (1-4 seconds per step)
    const stepDuration = 1000 + Math.floor(Math.random() * 3000);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, stepDuration);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });

    if (signal.aborted) return;

    const elapsedAfter = Date.now() - startTime;

    // navigation event for navigation steps
    if (step.id === 'navigate') {
      controller.enqueue(
        new TextEncoder().encode(
          formatSSE({
            type: 'navigation',
            step: step.label,
            stepIndex: i + 1,
            totalSteps,
            url: `https://${targetService.toLowerCase().replace(/\s+/g, '')}.com/account`,
            elapsed: elapsedAfter,
          }),
        ),
      );
    }

    // step_completed
    controller.enqueue(
      new TextEncoder().encode(
        formatSSE({
          type: 'step_completed',
          step: step.label,
          stepIndex: i + 1,
          totalSteps,
          elapsed: elapsedAfter,
        }),
      ),
    );

    // evidence_captured for capture/verify steps
    if (step.id === 'capture_proof' || step.id === 'verify' || step.id === 'capture_result') {
      controller.enqueue(
        new TextEncoder().encode(
          formatSSE({
            type: 'evidence_captured',
            evidenceType: 'text_summary',
            label: `${step.label} result`,
            stepIndex: i + 1,
            totalSteps,
            elapsed: elapsedAfter,
          }),
        ),
      );
    }
  }

  // completed
  const finalElapsed = Date.now() - startTime;
  controller.enqueue(
    new TextEncoder().encode(
      formatSSE({
        type: 'completed',
        totalSteps,
        elapsed: finalElapsed,
        simulated: true,
      }),
    ),
  );
}

// ── GET Handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'task_stream' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  const actionId = req.nextUrl.searchParams.get('actionId');
  if (!actionId || !actionId.trim()) {
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Missing required query parameter: actionId', true),
      { status: 400 },
    );
  }

  try {
    const userId = auth.auth.walletUserId;
    const action = await getAutomationAction({ userId, actionId });

    if (!action) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Action not found.', true),
        { status: 404 },
      );
    }

    logServerEvent('info', 'tasks.stream.start', {
      userId,
      actionId,
      actionType: action.actionType,
      status: action.status,
    });

    const abortController = new AbortController();
    const { signal } = abortController;

    // Set up the stream timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, STREAM_TIMEOUT_MS);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // TODO: When TinyFish run-sse endpoint is available, connect to it here.
          // For now, simulate progress from the action plan steps.
          //
          // Real implementation would:
          //   1. POST to ${TINY_FISH_BASE_URL}/v1/tasks/execute-stream
          //   2. Read the response as an SSE stream
          //   3. Forward events to the client with normalization

          await simulateFromPlan(controller, action, signal);
        } catch (error) {
          if (!signal.aborted) {
            const message = error instanceof Error ? error.message : 'Stream error';
            controller.enqueue(
              new TextEncoder().encode(
                formatSSE({
                  type: 'failed',
                  error: message,
                  elapsed: 0,
                }),
              ),
            );
          }
        } finally {
          clearTimeout(timeoutId);
          try {
            controller.close();
          } catch {
            // Stream may already be closed
          }
        }
      },
      cancel() {
        abortController.abort();
        clearTimeout(timeoutId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.message, true),
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to start action stream.';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'tasks.stream.failed', {
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
