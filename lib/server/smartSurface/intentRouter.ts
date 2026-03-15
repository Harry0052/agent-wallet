import "server-only";

import type { SmartSurfaceIntent } from "@/lib/server/smartSurface/types";

function includesAny(lowerPrompt: string, keywords: string[]): boolean {
  return keywords.some((keyword) => lowerPrompt.includes(keyword));
}

export function routeSmartSurfaceIntent(prompt: string): SmartSurfaceIntent {
  const lower = prompt.trim().toLowerCase();

  if (includesAny(lower, ["bill", "subscription", "lower", "save money", "found money"])) {
    return "lower_bills";
  }

  if (includesAny(lower, ["unusual", "anomal", "fraud", "strange charge"])) {
    return "review_unusual_spend";
  }

  if (includesAny(lower, ["cash", "30 day", "outlook", "runway", "budget"])) {
    return "plan_cash_30d";
  }

  if (includesAny(lower, ["how much", "spent", "spending"])) {
    return "query_spending";
  }

  if (includesAny(lower, ["health", "score"])) {
    return "query_health";
  }

  if (includesAny(lower, ["afford", "can i buy"])) {
    return "affordability_check";
  }

  if (includesAny(lower, ["connect", "sync", "stale", "reconnect"])) {
    return "check_connection_health";
  }

  return "overview";
}
