"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Briefcase,
  KeyRound,
  Shield,
  UserRound,
  WalletCards,
  Wrench,
} from "lucide-react";
import { Loader2, RefreshCw } from "lucide-react";
import { SettingsButton } from "@/components/settings/SettingsButton";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { EditProfileModal } from "@/modals/EditProfileModal";
import { WalletPreferencesModal } from "@/modals/WalletPreferencesModal";
import { SpendingGuardrailsModal } from "@/modals/SpendingGuardrailsModal";
import { NotificationSettingsModal } from "@/modals/NotificationSettingsModal";
import { SecuritySettingsModal } from "@/modals/SecuritySettingsModal";
import { ConnectedToolsModal } from "@/modals/ConnectedToolsModal";
import {
  fetchAuthenticatedAccount,
  type AuthenticatedAccount,
} from "@/services/account";

type OpenModal =
  | null
  | "edit-profile"
  | "security-password"
  | "security-2fa"
  | "wallet-preferences"
  | "spending-guardrails"
  | "notifications"
  | "integrations";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function SettingsPage() {
  const [account, setAccount] = useState<AuthenticatedAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  const refreshAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAuthenticatedAccount();
      setAccount(result);
    } catch (refreshError) {
      setError(toErrorMessage(refreshError, "Failed to load account settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  return (
    <div className="aw-page">
      <div className="aw-page-header flex items-start justify-between gap-3">
        <div>
          <p className="aw-page-kicker">Settings</p>
          <h1 className="aw-page-title">Account Settings</h1>
          <p className="aw-page-subtitle">
            Clean, app-style controls. Open a panel to edit each category.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refreshAccount();
          }}
          className="aw-button-secondary h-9 px-3 text-xs"
          disabled={loading}
        >
          <span className="inline-flex items-center gap-1">
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Refresh
          </span>
        </button>
      </div>

      {account?.email ? (
        <p className="mb-4 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 text-xs text-[var(--aw-text-soft)]">
          Signed in as {account.email}
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-xl border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SettingsSection title="Account">
          <SettingsButton
            label="Edit Profile"
            icon={UserRound}
            onClick={() => setOpenModal("edit-profile")}
          />
        </SettingsSection>

        <SettingsSection title="Security">
          <SettingsButton
            label="Change Password"
            icon={KeyRound}
            onClick={() => setOpenModal("security-password")}
          />
          <SettingsButton
            label="Two-Factor Authentication"
            icon={Shield}
            onClick={() => setOpenModal("security-2fa")}
          />
        </SettingsSection>

        <SettingsSection title="Agent Wallet">
          <SettingsButton
            label="Wallet Preferences"
            icon={WalletCards}
            onClick={() => setOpenModal("wallet-preferences")}
          />
          <SettingsButton
            label="Spending Guardrails"
            icon={Briefcase}
            onClick={() => setOpenModal("spending-guardrails")}
          />
        </SettingsSection>

        <SettingsSection title="Notifications">
          <SettingsButton
            label="Notification Settings"
            icon={Bell}
            onClick={() => setOpenModal("notifications")}
          />
        </SettingsSection>

        <SettingsSection title="Integrations">
          <SettingsButton
            label="Connected Tools"
            icon={Wrench}
            onClick={() => setOpenModal("integrations")}
          />
        </SettingsSection>
      </div>

      <EditProfileModal
        open={openModal === "edit-profile"}
        accountEmail={account?.email || ""}
        onClose={() => setOpenModal(null)}
        onSaved={() => {
          void refreshAccount();
        }}
      />

      <SecuritySettingsModal
        open={openModal === "security-password" || openModal === "security-2fa"}
        accountEmail={account?.email || ""}
        initialPanel={openModal === "security-2fa" ? "2fa" : "password"}
        onClose={() => setOpenModal(null)}
      />

      <WalletPreferencesModal
        open={openModal === "wallet-preferences"}
        onClose={() => setOpenModal(null)}
      />

      <SpendingGuardrailsModal
        open={openModal === "spending-guardrails"}
        onClose={() => setOpenModal(null)}
      />

      <NotificationSettingsModal
        open={openModal === "notifications"}
        onClose={() => setOpenModal(null)}
      />

      <ConnectedToolsModal
        open={openModal === "integrations"}
        onClose={() => setOpenModal(null)}
      />
    </div>
  );
}
