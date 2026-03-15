import 'server-only';

export interface SmartTelemetryBufferEvent {
  id: string;
  at: string;
  userId: string;
  event: string;
  context?: Record<string, unknown>;
}

const BUFFER_LIMIT = 200;
const GLOBAL_KEY = '__awSmartTelemetryRecentBuffer__';

function bufferStore(): SmartTelemetryBufferEvent[] {
  const globalScope = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: SmartTelemetryBufferEvent[];
  };
  if (!Array.isArray(globalScope[GLOBAL_KEY])) {
    globalScope[GLOBAL_KEY] = [];
  }
  return globalScope[GLOBAL_KEY] as SmartTelemetryBufferEvent[];
}

export function pushSmartTelemetryEvent(input: {
  userId: string;
  event: string;
  context?: Record<string, unknown>;
}): void {
  const buffer = bufferStore();
  buffer.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: new Date().toISOString(),
    userId: input.userId,
    event: input.event,
    ...(input.context ? { context: input.context } : {}),
  });

  if (buffer.length > BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - BUFFER_LIMIT);
  }
}

export function listRecentSmartTelemetryEvents(input: {
  userId: string;
  limit: number;
}): SmartTelemetryBufferEvent[] {
  const buffer = bufferStore();
  const scoped = buffer.filter((event) => event.userId === input.userId);
  return scoped.slice(-input.limit).reverse();
}
