import type {
  MoneyAdvancedIntelligence,
  MoneyScenarioAssumptions,
  MoneyScenarioSimulation,
} from "@/lib/server/moneyIntelligence/types";

import { toUserFriendlyError } from "./apiErrorMessage";

function toError(payload: { error?: string; errorCode?: string }): Error {
  return toUserFriendlyError(payload);
}

export async function fetchAdvancedIntelligence(): Promise<MoneyAdvancedIntelligence> {
  const response = await fetch("/api/intelligence/advanced", {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    advancedIntelligence?: MoneyAdvancedIntelligence;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !payload.ok || !payload.advancedIntelligence) {
    throw toError(payload);
  }
  return payload.advancedIntelligence;
}

export async function runAdvancedScenarioSimulation(input: {
  assumptions: Omit<MoneyScenarioAssumptions, "id" | "label"> & {
    id?: string;
    label?: string;
  };
}): Promise<{ scenario: MoneyScenarioSimulation; baseline: MoneyScenarioSimulation }> {
  const response = await fetch("/api/intelligence/advanced", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.assumptions),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    scenario?: MoneyScenarioSimulation;
    baseline?: MoneyScenarioSimulation;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !payload.ok || !payload.scenario || !payload.baseline) {
    throw toError(payload);
  }

  return {
    scenario: payload.scenario,
    baseline: payload.baseline,
  };
}

