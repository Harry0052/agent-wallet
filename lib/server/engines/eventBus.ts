import 'server-only';

import { logServerEvent } from '@/lib/server/observability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EngineEventType =
  | 'transaction_synced'
  | 'subscription_detected'
  | 'spending_spike'
  | 'balance_changed'
  | 'income_received';

export interface EngineEvent {
  type: EngineEventType;
  userId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

type EventHandler = (event: EngineEvent) => Promise<void> | void;

// ---------------------------------------------------------------------------
// Singleton EventBus
// ---------------------------------------------------------------------------

class EventBus {
  private static instance: EventBus | null = null;

  private handlers = new Map<EngineEventType, Set<EventHandler>>();

  private constructor() {}

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  subscribe(type: EngineEventType, handler: EventHandler): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }

  unsubscribe(type: EngineEventType, handler: EventHandler): void {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(type);
    }
  }

  emit(event: EngineEvent): void {
    const set = this.handlers.get(event.type);
    if (!set || set.size === 0) return;

    for (const handler of set) {
      try {
        const maybePromise = handler(event);
        if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
          (maybePromise as Promise<void>).catch((err) => {
            logServerEvent('error', 'engine.eventbus.handler_error', {
              eventType: event.type,
              userId: event.userId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        logServerEvent('error', 'engine.eventbus.handler_error', {
          eventType: event.type,
          userId: event.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Default handlers (registered on module load)
// ---------------------------------------------------------------------------

const bus = EventBus.getInstance();

bus.subscribe('transaction_synced', async (event) => {
  try {
    const { generateInsights } = await import(
      '@/lib/server/engines/insightEngine'
    );
    await generateInsights(event.userId);
  } catch {
    // Insight generator may not exist yet — swallow gracefully
    logServerEvent('info', 'engine.eventbus.insight_generator_unavailable', {
      userId: event.userId,
    });
  }
});

bus.subscribe('subscription_detected', (event) => {
  logServerEvent('info', 'engine.eventbus.subscription_detected', {
    userId: event.userId,
    payload: event.payload,
  });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const engineEventBus = EventBus.getInstance();

export function emitEngineEvent(
  type: EngineEventType,
  userId: string,
  payload: Record<string, unknown>,
): void {
  engineEventBus.emit({
    type,
    userId,
    payload,
    timestamp: new Date().toISOString(),
  });
}
