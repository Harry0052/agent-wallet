"use client";

import { useEffect, useMemo, useState } from "react";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { useApp } from "@/lib/store";

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToText(items: string[]): string {
  return items.join(", ");
}

interface SpendingGuardrailsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SpendingGuardrailsModal({
  open,
  onClose,
}: SpendingGuardrailsModalProps) {
  const { wallet, updateSettings } = useApp();
  const settings = wallet.settings;

  const [maxTransaction, setMaxTransaction] = useState(settings.maxTransaction);
  const [dailyLimit, setDailyLimit] = useState(settings.dailyLimit);
  const [monthlyBudget, setMonthlyBudget] = useState(settings.monthlyBudget);
  const [approvalThreshold, setApprovalThreshold] = useState(
    settings.approvalThreshold,
  );
  const [allowedText, setAllowedText] = useState(
    listToText(settings.allowedMerchants),
  );
  const [blockedText, setBlockedText] = useState(
    listToText(settings.blockedMerchants),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMaxTransaction(settings.maxTransaction);
    setDailyLimit(settings.dailyLimit);
    setMonthlyBudget(settings.monthlyBudget);
    setApprovalThreshold(settings.approvalThreshold);
    setAllowedText(listToText(settings.allowedMerchants));
    setBlockedText(listToText(settings.blockedMerchants));
    setError(null);
  }, [open, settings]);

  const dirty = useMemo(() => {
    return (
      maxTransaction !== settings.maxTransaction
      || dailyLimit !== settings.dailyLimit
      || monthlyBudget !== settings.monthlyBudget
      || approvalThreshold !== settings.approvalThreshold
      || allowedText !== listToText(settings.allowedMerchants)
      || blockedText !== listToText(settings.blockedMerchants)
    );
  }, [
    allowedText,
    approvalThreshold,
    blockedText,
    dailyLimit,
    maxTransaction,
    monthlyBudget,
    settings,
  ]);

  const saveGuardrails = async () => {
    setError(null);
    const numericValues = [
      maxTransaction,
      dailyLimit,
      monthlyBudget,
      approvalThreshold,
    ];
    if (numericValues.some((value) => Number.isNaN(value) || value < 1)) {
      setError("All numeric values must be at least 1.");
      return;
    }

    setSaving(true);
    try {
      await updateSettings({
        maxTransaction,
        dailyLimit,
        monthlyBudget,
        approvalThreshold,
        allowedMerchants: parseList(allowedText),
        blockedMerchants: parseList(blockedText),
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="Spending Guardrails"
      description="Configure policy limits, approvals, and merchant controls."
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-[var(--aw-text-muted)]">Max transaction</span>
          <input
            type="number"
            min={1}
            value={maxTransaction}
            onChange={(event) =>
              setMaxTransaction(Math.max(1, parseInt(event.target.value, 10) || 1))
            }
            className="aw-input h-10 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-[var(--aw-text-muted)]">Daily limit</span>
          <input
            type="number"
            min={1}
            value={dailyLimit}
            onChange={(event) =>
              setDailyLimit(Math.max(1, parseInt(event.target.value, 10) || 1))
            }
            className="aw-input h-10 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-[var(--aw-text-muted)]">Monthly budget</span>
          <input
            type="number"
            min={1}
            value={monthlyBudget}
            onChange={(event) =>
              setMonthlyBudget(Math.max(1, parseInt(event.target.value, 10) || 1))
            }
            className="aw-input h-10 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-[var(--aw-text-muted)]">
            Approval threshold
          </span>
          <input
            type="number"
            min={1}
            value={approvalThreshold}
            onChange={(event) =>
              setApprovalThreshold(
                Math.max(1, parseInt(event.target.value, 10) || 1),
              )
            }
            className="aw-input h-10 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 space-y-3">
        <label className="space-y-1">
          <span className="text-xs text-[var(--aw-text-muted)]">
            Allowed merchants (comma-separated)
          </span>
          <input
            type="text"
            value={allowedText}
            onChange={(event) => setAllowedText(event.target.value)}
            placeholder="Starbucks, Peet's"
            className="aw-input h-10 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-[var(--aw-text-muted)]">
            Blocked merchants (comma-separated)
          </span>
          <input
            type="text"
            value={blockedText}
            onChange={(event) => setBlockedText(event.target.value)}
            placeholder="Doordash, Uber Eats"
            className="aw-input h-10 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="aw-button-primary h-10 px-4 text-sm"
          onClick={() => {
            void saveGuardrails();
          }}
          disabled={saving || !dirty}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          className="aw-button-secondary h-10 px-4 text-sm"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
          {error}
        </p>
      ) : null}
    </SettingsModal>
  );
}
