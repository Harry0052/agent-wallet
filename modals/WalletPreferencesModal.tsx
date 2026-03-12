"use client";

import { useEffect, useState } from "react";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { useApp } from "@/lib/store";

interface WalletPreferencesModalProps {
  open: boolean;
  onClose: () => void;
}

export function WalletPreferencesModal({
  open,
  onClose,
}: WalletPreferencesModalProps) {
  const { wallet, updateSettings, addRecipient } = useApp();
  const [requireLocation, setRequireLocation] = useState(
    wallet.settings.requireLocation,
  );
  const [recipientName, setRecipientName] = useState("");
  const [recipientAccount, setRecipientAccount] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRequireLocation(wallet.settings.requireLocation);
    setRecipientName("");
    setRecipientAccount("");
    setNotice(null);
    setError(null);
  }, [open, wallet.settings.requireLocation]);

  const savePreferences = async () => {
    setError(null);
    setNotice(null);
    setSaving(true);

    try {
      await updateSettings({ requireLocation });
      setNotice("Wallet preferences saved.");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const submitRecipient = async () => {
    const name = recipientName.trim();
    const account = recipientAccount.trim();
    if (!name || !account) {
      setError("Recipient name and account id are required.");
      return;
    }

    setAddingRecipient(true);
    setError(null);
    setNotice(null);
    try {
      await addRecipient(name, account);
      setRecipientName("");
      setRecipientAccount("");
      setNotice("Approved recipient added.");
    } catch (recipientError) {
      setError(
        recipientError instanceof Error
          ? recipientError.message
          : "Could not add recipient.",
      );
    } finally {
      setAddingRecipient(false);
    }
  };

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="Wallet Preferences"
      description="Configure wallet defaults and recipient controls."
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
          <p className="text-xs text-[var(--aw-text-soft)]">
            Require location for local search
          </p>
          <button
            type="button"
            onClick={() => setRequireLocation((prev) => !prev)}
            className={`relative h-5 w-10 rounded-full transition-colors ${requireLocation ? "bg-[rgba(88,166,132,0.9)]" : "bg-[rgba(255,255,255,0.22)]"}`}
            aria-label="Toggle location requirement"
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${requireLocation ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-[var(--aw-text-muted)]">
            Approved recipients (Stripe Connect <code>acct_...</code>)
          </p>
          <div className="aw-scroll max-h-28 overflow-y-auto rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 space-y-1">
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

          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input
              type="text"
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder="Recipient name"
              className="aw-input h-10 text-sm"
            />
            <input
              type="text"
              value={recipientAccount}
              onChange={(event) => setRecipientAccount(event.target.value)}
              placeholder="acct_..."
              className="aw-input h-10 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                void submitRecipient();
              }}
              disabled={addingRecipient}
              className="aw-button-secondary h-10 px-3 text-sm"
            >
              {addingRecipient ? "Adding..." : "Add Recipient"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void savePreferences();
            }}
            disabled={saving}
            className="aw-button-primary h-10 px-4 text-sm"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="aw-button-secondary h-10 px-4 text-sm"
            disabled={saving}
          >
            Cancel
          </button>
        </div>

        {notice ? (
          <p className="rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsModal>
  );
}
