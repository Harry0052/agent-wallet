"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { requestPasswordReset, logout } from "@/services/auth";
import { deleteAuthenticatedAccount } from "@/services/account";

type SecurityPanel = "password" | "2fa";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

interface SecuritySettingsModalProps {
  open: boolean;
  accountEmail: string;
  initialPanel: SecurityPanel;
  onClose: () => void;
}

export function SecuritySettingsModal({
  open,
  accountEmail,
  initialPanel,
  onClose,
}: SecuritySettingsModalProps) {
  const [panel, setPanel] = useState<SecurityPanel>(initialPanel);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPanel(initialPanel);
    setResetNotice(null);
    setResetError(null);
    setDeletePassword("");
    setDeleteConfirmText("");
    setDeleteError(null);
  }, [initialPanel, open]);

  const canSubmitDelete = useMemo(
    () =>
      deletePassword.trim().length > 0
      && deleteConfirmText.trim().toUpperCase() === "DELETE"
      && !deleteLoading,
    [deleteConfirmText, deleteLoading, deletePassword],
  );

  const sendResetLink = async () => {
    if (!accountEmail) {
      setResetError("Could not resolve your account email.");
      return;
    }

    setResetError(null);
    setResetNotice(null);
    setResetLoading(true);
    try {
      const result = await requestPasswordReset({ email: accountEmail });
      setResetNotice(result.message);
      onClose();
    } catch (error) {
      setResetError(toErrorMessage(error, "Failed to send reset link."));
    } finally {
      setResetLoading(false);
    }
  };

  const signOutNow = async () => {
    setSigningOut(true);
    try {
      await logout();
      window.location.href = "/login";
    } finally {
      setSigningOut(false);
    }
  };

  const confirmDeleteAccount = async () => {
    setDeleteError(null);
    setDeleteLoading(true);

    try {
      await deleteAuthenticatedAccount({
        password: deletePassword,
        confirmText: deleteConfirmText,
      });
      window.location.href = "/login?accountDeleted=1";
    } catch (error) {
      setDeleteError(toErrorMessage(error, "Failed to delete account."));
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="Security Settings"
      description="Password flows, account security, and destructive account controls."
      maxWidthClassName="max-w-2xl"
    >
      <div className="mb-4 inline-flex rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-1">
        <button
          type="button"
          className={`h-8 rounded-md px-3 text-xs ${panel === "password" ? "bg-[var(--aw-surface-1)] text-[var(--aw-text)]" : "text-[var(--aw-text-soft)]"}`}
          onClick={() => setPanel("password")}
        >
          Change Password
        </button>
        <button
          type="button"
          className={`h-8 rounded-md px-3 text-xs ${panel === "2fa" ? "bg-[var(--aw-surface-1)] text-[var(--aw-text)]" : "text-[var(--aw-text-soft)]"}`}
          onClick={() => setPanel("2fa")}
        >
          Two-Factor Authentication
        </button>
      </div>

      {panel === "password" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
            <p className="text-xs text-[var(--aw-text-soft)]">
              Send a password reset link to <span className="font-medium">{accountEmail || "your account email"}</span>.
            </p>
            <button
              type="button"
              onClick={() => {
                void sendResetLink();
              }}
              className="aw-button-primary mt-3 h-10 px-4 text-sm"
              disabled={resetLoading || !accountEmail}
            >
              {resetLoading ? "Sending reset link..." : "Send Password Reset Link"}
            </button>
          </div>

          <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
            <p className="text-xs text-[var(--aw-text-soft)]">
              Sign out of this session.
            </p>
            <button
              type="button"
              onClick={() => {
                void signOutNow();
              }}
              className="aw-button-secondary mt-3 h-10 px-4 text-sm"
              disabled={signingOut}
            >
              {signingOut ? "Signing out..." : "Sign Out"}
            </button>
          </div>

          {resetNotice ? (
            <p className="rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
              {resetNotice}
            </p>
          ) : null}
          {resetError ? (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {resetError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
            <p className="text-sm font-semibold text-[var(--aw-text)]">
              Two-Factor Authentication
            </p>
            <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
              2FA enrollment UI is reserved for your identity provider integration. This control remains available as a dedicated security panel.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/5 px-3 py-3">
            <div className="flex items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5 text-[var(--aw-danger)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--aw-text)]">Delete Account</p>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  This action is permanent. Enter your password and type DELETE.
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <input
                type="password"
                className="aw-input h-10 text-sm"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Current password"
              />
              <input
                type="text"
                className="aw-input h-10 text-sm"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder="Type DELETE"
              />
            </div>

            {deleteError ? (
              <p className="mt-2 rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
                {deleteError}
              </p>
            ) : null}

            <button
              type="button"
              className="aw-button-secondary mt-3 inline-flex h-10 items-center gap-1 border-[var(--aw-danger)]/30 px-3 text-sm text-[var(--aw-danger)] hover:border-[var(--aw-danger)]"
              disabled={!canSubmitDelete}
              onClick={() => {
                void confirmDeleteAccount();
              }}
            >
              <Trash2 size={13} />
              {deleteLoading ? "Deleting..." : "Delete My Account"}
            </button>
          </div>
        </div>
      )}
    </SettingsModal>
  );
}
