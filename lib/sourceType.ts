import type { RecordSourceType } from "@/lib/manualMode";

const CONNECTED_STATES = new Set(["connected", "synced", "imported", "inferred"]);
const MANUAL_STATES = new Set(["manual"]);

export function normalizeRecordSourceType(
  value: unknown,
  fallback: RecordSourceType = "connected",
): RecordSourceType {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (MANUAL_STATES.has(normalized)) return "manual";
  if (CONNECTED_STATES.has(normalized)) return "connected";
  return fallback;
}

export function sourceTypeUiLabel(sourceType: RecordSourceType): string {
  return sourceType === "manual" ? "Manual" : "Connected";
}
