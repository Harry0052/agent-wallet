import "server-only";

export function isInternalActionsRuntimeEnabled(): boolean {
  return process.env.SMART_WALLET_INTERNAL_ACTIONS_RUNTIME === "1";
}
