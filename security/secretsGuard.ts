import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

interface AiExecutionContext {
  ai: true;
}

declare global {
  var __aiExecutionContextStorage: AsyncLocalStorage<AiExecutionContext> | undefined;
}

const AI_PATH_MARKERS = ["/ai_spend_intelligence/", "/app/api/ai/"];
const CONNECTOR_PATH_MARKER = "/financial_connectors/";

function getAiExecutionStorage(): AsyncLocalStorage<AiExecutionContext> {
  if (!globalThis.__aiExecutionContextStorage) {
    globalThis.__aiExecutionContextStorage =
      new AsyncLocalStorage<AiExecutionContext>();
  }
  return globalThis.__aiExecutionContextStorage;
}

function stackContainsAiPath(stack: string): boolean {
  return AI_PATH_MARKERS.some((marker) => stack.includes(marker));
}

export async function runInAiExecutionContext<T>(
  work: () => Promise<T>,
): Promise<T> {
  const storage = getAiExecutionStorage();
  return storage.run({ ai: true }, work);
}

export function assertNoAiFinancialConnectorAccess(modulePath: string): void {
  if (!modulePath.includes(CONNECTOR_PATH_MARKER)) {
    return;
  }

  const storage = getAiExecutionStorage();
  const inAiExecution = Boolean(storage.getStore()?.ai);
  const stack = new Error().stack || "";
  const importedFromAiStack = stackContainsAiPath(stack);

  if (inAiExecution || importedFromAiStack) {
    throw new Error(
      `SECURITY_VIOLATION: AI execution attempted to access sensitive connector module (${modulePath}).`,
    );
  }
}
