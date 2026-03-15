import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import {
  generateTasks,
  updateTaskStatus,
  listSurfacedTasks,
} from '@/lib/server/engines/taskEngine';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

const MAX_SURFACED = 5;
const MAX_CRITICAL = 1;

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'ai_tasks' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const allTasks = await listSurfacedTasks(userId);

    let criticalCount = 0;
    const surfaced = [];

    for (const task of allTasks) {
      if (surfaced.length >= MAX_SURFACED) break;

      const priority = task.input?.priority;
      if (priority === 'high' || (typeof task.priority === 'number' && task.priority >= 8)) {
        if (criticalCount >= MAX_CRITICAL) continue;
        criticalCount += 1;
      }

      surfaced.push(task);
    }

    return NextResponse.json({ ok: true, tasks: surfaced });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.message, true),
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to list tasks';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'ai.tasks.list.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'ai_tasks_generate' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const result = await generateTasks(userId);

    logServerEvent('info', 'ai.tasks.generate.success', {
      userId,
      tasksCreated: result.tasksCreated,
      tasksSuppressed: result.tasksSuppressed,
      latencyMs: result.latencyMs,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.message, true),
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to generate tasks';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'ai.tasks.generate.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

const PatchSchema = z.object({
  taskId: z.string().trim().min(1),
  status: z.enum(['completed', 'dismissed', 'snoozed']),
  snoozedUntil: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'ai_tasks_update' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const body = PatchSchema.parse(await req.json());

    await updateTaskStatus({
      userId,
      taskId: body.taskId,
      status: body.status,
      snoozedUntil: body.snoozedUntil,
    });

    logServerEvent('info', 'ai.tasks.update.success', {
      userId,
      taskId: body.taskId,
      status: body.status,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.message, true),
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.errors.map((e) => e.message).join(', '), true),
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to update task';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'ai.tasks.update.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
