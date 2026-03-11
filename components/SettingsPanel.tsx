"use client";

import { useMemo, useState } from "react";
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

export function SettingsPanel({ alwaysShow }: { alwaysShow?: boolean } = {}) {
  const { wallet, updateSettings, addRecipient, showSettings, toggleSettings } =
    useApp();
  const settings = wallet.settings;
  const [isAgentRulesOpen, setIsAgentRulesOpen] = useState(!alwaysShow);
  const [recipientName, setRecipientName] = useState("");
  const [recipientAccount, setRecipientAccount] = useState("");

  const allowedText = useMemo(
    () => listToText(settings.allowedMerchants),
    [settings.allowedMerchants],
  );
  const blockedText = useMemo(
    () => listToText(settings.blockedMerchants),
    [settings.blockedMerchants],
  );

  if (!alwaysShow && !showSettings) return null;

  const submitRecipient = async () => {
    const name = recipientName.trim();
    const account = recipientAccount.trim();
    if (!name || !account) return;
    await addRecipient(name, account);
    setRecipientName("");
    setRecipientAccount("");
  };

  const rulesBlock = (
    <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
            Agent Rules
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--aw-text-muted)]">
            Spending limits, approvals, and merchant controls.
          </p>
        </div>
        <button
          onClick={() => setIsAgentRulesOpen((prev) => !prev)}
          className="aw-button-secondary px-3 py-1.5 text-xs"
        >
          {isAgentRulesOpen ? "Hide Rules" : "Open Rules"}
        </button>
      </div>

      {isAgentRulesOpen && (
        <div className="mt-3 grid grid-cols-1 gap-3 animate-sheet-rise">
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">
              Max transaction
            </span>
            <input
              type="number"
              min={1}
              value={settings.maxTransaction}
              onChange={(e) =>
                updateSettings({
                  maxTransaction: Math.max(1, parseInt(e.target.value, 10) || 1),
                })
              }
              className="aw-input h-10 text-sm"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">
              Daily limit
            </span>
            <input
              type="number"
              min={1}
              value={settings.dailyLimit}
              onChange={(e) =>
                updateSettings({
                  dailyLimit: Math.max(1, parseInt(e.target.value, 10) || 1),
                })
              }
              className="aw-input h-10 text-sm"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">
              Monthly budget
            </span>
            <input
              type="number"
              min={1}
              value={settings.monthlyBudget}
              onChange={(e) =>
                updateSettings({
                  monthlyBudget: Math.max(1, parseInt(e.target.value, 10) || 1),
                })
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
              value={settings.approvalThreshold}
              onChange={(e) =>
                updateSettings({
                  approvalThreshold: Math.max(
                    1,
                    parseInt(e.target.value, 10) || 1,
                  ),
                })
              }
              className="aw-input h-10 text-sm"
            />
            <p className="text-[11px] text-[var(--aw-text-muted)]">
              Actions at or above this amount require explicit approval.
            </p>
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">
              Allowed merchants (comma-separated)
            </span>
            <input
              type="text"
              value={allowedText}
              onChange={(e) =>
                updateSettings({ allowedMerchants: parseList(e.target.value) })
              }
              placeholder="Starbucks, Peet's"
              className="aw-input h-10 text-sm"
            />
            <p className="text-[11px] text-[var(--aw-text-muted)]">
              Leave empty to allow all non-blocked merchants.
            </p>
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">
              Blocked merchants (comma-separated)
            </span>
            <input
              type="text"
              value={blockedText}
              onChange={(e) =>
                updateSettings({ blockedMerchants: parseList(e.target.value) })
              }
              placeholder="Doordash, Uber Eats"
              className="aw-input h-10 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );

  const recipientBlock = (
    <div className="border-t border-[var(--aw-border)] pt-3 space-y-2">
      <label className="text-xs text-[var(--aw-text-muted)]">
        Approved recipients (Stripe Connect `acct_...`)
      </label>

      <div className="aw-scroll max-h-24 overflow-y-auto rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 space-y-1">
        {wallet.recipients.length === 0 ? (
          <p className="text-[11px] text-[var(--aw-text-muted)]">
            No approved recipients saved yet.
          </p>
        ) : (
          wallet.recipients.map((recipient) => (
            <div
              key={recipient.id}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="truncate text-[var(--aw-text-soft)]">
                {recipient.name}
              </span>
              <span className="text-[var(--aw-text-muted)]">
                {recipient.status}
              </span>
            </div>
          ))
        )}
      </div>

      <input
        type="text"
        value={recipientName}
        onChange={(e) => setRecipientName(e.target.value)}
        placeholder="Recipient name"
        className="aw-input h-10 text-sm"
      />
      <input
        type="text"
        value={recipientAccount}
        onChange={(e) => setRecipientAccount(e.target.value)}
        placeholder="acct_..."
        className="aw-input h-10 text-sm"
      />
      <button
        onClick={() => {
          void submitRecipient();
        }}
        className="aw-button-primary h-10 w-full text-xs"
      >
        Add Approved Recipient
      </button>
    </div>
  );

  return (
    <section className="aw-surface p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="aw-kicker">Settings</p>
          <h3 className="text-sm font-semibold text-[var(--aw-text)]">
            Agent Rules
          </h3>
        </div>
        {!alwaysShow && (
          <button
            onClick={toggleSettings}
            className="aw-button-secondary px-3 py-1.5 text-xs"
          >
            Close
          </button>
        )}
      </div>

      {rulesBlock}

      <div className="flex items-center justify-between rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
        <p className="text-xs text-[var(--aw-text-soft)]">
          Require location for local search
        </p>
        <button
          onClick={() =>
            updateSettings({ requireLocation: !settings.requireLocation })
          }
          className={`relative h-5 w-10 rounded-full transition-colors ${settings.requireLocation ? "bg-[rgba(88,166,132,0.9)]" : "bg-[rgba(255,255,255,0.22)]"}`}
          aria-label="Toggle location requirement"
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.requireLocation ? "translate-x-5" : "translate-x-0.5"}`}
          />
        </button>
      </div>

      {recipientBlock}
    </section>
  );
}
