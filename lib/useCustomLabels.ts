"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "calico.custom-labels.v1";

/** Internal route keys → user-visible labels. Only display labels change. */
export type CustomLabelMap = Record<string, string>;

const DEFAULT_LABELS: CustomLabelMap = {
  home: "Home",
  accounts: "Accounts",
  transactions: "Money Moves",
  tasks: "To-Do",
  cashflow: "Cash Flow",
  budgets: "Spending Plan",
  goals: "Money Goals",
  investments: "Investments",
  reports: "Reports",
  insights: "Calico Noticed",
  automations: "Automations",
  settings: "Settings",
};

function loadLabels(): CustomLabelMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_LABELS, ...parsed };
      }
    }
  } catch {
    // Ignore
  }
  return { ...DEFAULT_LABELS };
}

function saveLabels(labels: CustomLabelMap): void {
  try {
    // Only store overrides (differences from defaults)
    const overrides: CustomLabelMap = {};
    for (const [key, value] of Object.entries(labels)) {
      if (value !== DEFAULT_LABELS[key]) {
        overrides[key] = value;
      }
    }
    if (Object.keys(overrides).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    }
  } catch {
    // Storage unavailable
  }
}

export function useCustomLabels() {
  const [labels, setLabels] = useState<CustomLabelMap>(DEFAULT_LABELS);

  useEffect(() => {
    setLabels(loadLabels());
  }, []);

  const setLabel = useCallback((key: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // Cap at 24 chars to prevent layout breakage
    const capped = trimmed.slice(0, 24);
    setLabels((prev) => {
      const next = { ...prev, [key]: capped };
      saveLabels(next);
      return next;
    });
  }, []);

  const resetLabel = useCallback((key: string) => {
    setLabels((prev) => {
      const next = { ...prev, [key]: DEFAULT_LABELS[key] ?? key };
      saveLabels(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    const fresh = { ...DEFAULT_LABELS };
    setLabels(fresh);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  const getLabel = useCallback(
    (key: string) => labels[key] ?? DEFAULT_LABELS[key] ?? key,
    [labels],
  );

  return { labels, getLabel, setLabel, resetLabel, resetAll, defaults: DEFAULT_LABELS };
}
