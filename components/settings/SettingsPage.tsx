"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Cable,
  ChevronRight,
  KeyRound,
  LogOut,
  UserRound,
} from "lucide-react";
import { EditProfileModal } from "@/modals/EditProfileModal";
import { NotificationSettingsModal } from "@/modals/NotificationSettingsModal";
import { SecuritySettingsModal } from "@/modals/SecuritySettingsModal";
import {
  fetchAuthenticatedAccount,
  type AuthenticatedAccount,
} from "@/services/account";
import { logout } from "@/services/auth";

type OpenModal = null | "edit-profile" | "security" | "notifications";

interface SettingRowProps {
  icon: typeof UserRound;
  label: string;
  onClick: () => void;
}

function SettingRow({ icon: Icon, label, onClick }: SettingRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl px-4 py-3.5 transition hover:bg-[var(--aw-surface-subtle)]"
    >
      <span className="inline-flex items-center gap-3 text-sm font-medium text-[var(--aw-text)]">
        <Icon size={16} className="text-[var(--aw-text-muted)]" />
        {label}
      </span>
      <ChevronRight size={14} className="text-[var(--aw-text-muted)]" />
    </button>
  );
}

export function SettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<AuthenticatedAccount | null>(null);
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  const refreshAccount = useCallback(async () => {
    try {
      setAccount(await fetchAuthenticatedAccount());
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  const onLogout = async () => {
    await logout();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="aw-page">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--aw-text)]">
        Settings
      </h1>

      {account?.email ? (
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">{account.email}</p>
      ) : null}

      <div className="aw-card mt-8 !p-2">
        <div className="space-y-0.5">
          <SettingRow icon={UserRound} label="Profile" onClick={() => setOpenModal("edit-profile")} />
          <SettingRow icon={KeyRound} label="Password & 2FA" onClick={() => setOpenModal("security")} />
          <SettingRow icon={Bell} label="Notifications" onClick={() => setOpenModal("notifications")} />
          <SettingRow icon={Cable} label="Connected accounts" onClick={() => { window.location.href = "/connect"; }} />
        </div>
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => {
            void onLogout();
          }}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[var(--aw-danger)] transition hover:bg-[var(--aw-danger)]/10"
        >
          <LogOut size={14} />
          Log out
        </button>
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
        open={openModal === "security"}
        accountEmail={account?.email || ""}
        initialPanel="password"
        onClose={() => setOpenModal(null)}
      />

      <NotificationSettingsModal
        open={openModal === "notifications"}
        onClose={() => setOpenModal(null)}
      />
    </div>
  );
}
