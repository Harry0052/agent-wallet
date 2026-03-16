"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Cable,
  ChevronRight,
  CreditCard,
  KeyRound,
  LogOut,
  Trash2,
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
import {
  fetchBillingStatus,
  startCheckout,
  openBillingPortal,
  type BillingStatus,
  type PlanId,
} from "@/services/billing";
import { deleteAccount } from "@/services/entitlements";

type OpenModal = null | "edit-profile" | "security" | "notifications";

interface SettingRowProps {
  icon: typeof UserRound;
  label: string;
  sublabel?: string;
  onClick: () => void;
}

function SettingRow({ icon: Icon, label, sublabel, onClick }: SettingRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl px-4 py-3.5 transition hover:bg-[var(--aw-surface-subtle)]"
    >
      <span className="inline-flex items-center gap-3 text-sm font-medium text-[var(--aw-text)]">
        <Icon size={16} className="text-[var(--aw-text-muted)]" />
        <span>
          {label}
          {sublabel && (
            <span className="ml-2 text-xs font-normal text-[var(--aw-text-muted)]">
              {sublabel}
            </span>
          )}
        </span>
      </span>
      <ChevronRight size={14} className="text-[var(--aw-text-muted)]" />
    </button>
  );
}

function BillingBanner({ billing, onManage }: { billing: BillingStatus; onManage: () => void }) {
  if (!billing.isActive && !billing.plan) {
    return (
      <div className="aw-card mt-6 !p-4" style={{ borderLeft: "3px solid var(--calico-primary, #FDBA74)" }}>
        <p className="text-sm font-semibold text-[var(--aw-text)]">No active plan</p>
        <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
          Subscribe to a plan to unlock all features.
        </p>
        <div className="mt-3 flex gap-2">
          {(["starter", "pro", "autonomous"] as PlanId[]).map((plan) => (
            <button
              key={plan}
              type="button"
              onClick={() => { void startCheckout(plan); }}
              className="rounded-full px-3 py-1.5 text-xs font-semibold transition"
              style={{
                background: plan === "pro" ? "var(--calico-primary, #FDBA74)" : "var(--calico-card, #FFFCF8)",
                color: "var(--calico-text, #111)",
                border: plan === "pro" ? "none" : "1px solid var(--calico-border, #F2DECC)",
              }}
            >
              {plan === "starter" ? "Start Free Trial" : plan === "pro" ? "Subscribe Pro" : "Autonomous"}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const statusLabel = billing.isTrial
    ? `${billing.planName} (trial${billing.trialEnd ? ` until ${new Date(billing.trialEnd).toLocaleDateString()}` : ""})`
    : billing.cancelAtPeriodEnd
      ? `${billing.planName} (cancels ${billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd).toLocaleDateString() : "soon"})`
      : `${billing.planName} — $${billing.priceMonthly}/mo`;

  return (
    <div className="aw-card mt-6 !p-4" style={{ borderLeft: "3px solid var(--calico-primary, #FDBA74)" }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--aw-text)]">{statusLabel}</p>
          <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
            {billing.status === "active" && !billing.cancelAtPeriodEnd && "Active subscription"}
            {billing.status === "trialing" && "Free trial active"}
            {billing.cancelAtPeriodEnd && "Will cancel at end of period"}
            {billing.status === "past_due" && "Payment past due — update your card"}
            {billing.status === "canceled" && "Subscription canceled"}
          </p>
        </div>
        <button
          type="button"
          onClick={onManage}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          style={{
            background: "var(--calico-card, #FFFCF8)",
            border: "1px solid var(--calico-border, #F2DECC)",
            color: "var(--calico-text, #111)",
          }}
        >
          Manage billing
        </button>
      </div>
    </div>
  );
}

function DeleteAccountButton() {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (confirmText !== "DELETE MY ACCOUNT") return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(confirmText);
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Deletion failed");
      setIsDeleting(false);
    }
  };

  if (!showConfirm) {
    return (
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-[var(--aw-danger)] transition hover:bg-[var(--aw-danger)]/10"
      >
        <Trash2 size={13} />
        Delete account
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-[var(--aw-danger)]">
        Type <strong>DELETE MY ACCOUNT</strong> to confirm:
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="DELETE MY ACCOUNT"
        className="aw-input h-9 w-full text-xs"
        style={{ borderColor: "var(--aw-danger)" }}
      />
      {deleteError && (
        <p className="text-xs text-[var(--aw-danger)]">{deleteError}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={confirmText !== "DELETE MY ACCOUNT" || isDeleting}
          className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
          style={{ background: "var(--aw-danger)" }}
        >
          {isDeleting ? "Deleting..." : "Permanently delete"}
        </button>
        <button
          type="button"
          onClick={() => { setShowConfirm(false); setConfirmText(""); }}
          className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--aw-text-muted)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<AuthenticatedAccount | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);

  const refreshAccount = useCallback(async () => {
    try {
      setAccount(await fetchAuthenticatedAccount());
    } catch {
      // silent
    }
  }, []);

  const refreshBilling = useCallback(async () => {
    try {
      setBilling(await fetchBillingStatus());
    } catch {
      // silent — user may not have billing yet
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
    void refreshBilling();
  }, [refreshAccount, refreshBilling]);

  useEffect(() => {
    const billingParam = searchParams.get("billing");
    if (billingParam === "success") {
      setBillingMessage("Subscription activated! Welcome aboard.");
      void refreshBilling();
      window.history.replaceState({}, "", "/settings");
    } else if (billingParam === "cancelled") {
      setBillingMessage("Checkout was cancelled. You can try again anytime.");
      window.history.replaceState({}, "", "/settings");
    }
  }, [searchParams, refreshBilling]);

  const onLogout = async () => {
    await logout();
    router.replace("/login");
    router.refresh();
  };

  const handleManageBilling = () => {
    void openBillingPortal();
  };

  return (
    <div className="aw-page">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--aw-text)]">
        Settings
      </h1>

      {account?.email ? (
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">{account.email}</p>
      ) : null}

      {billingMessage && (
        <div className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(253,186,116,0.18)", border: "1px solid var(--calico-primary, #FDBA74)", color: "var(--calico-text, #111)" }}>
          {billingMessage}
          <button type="button" onClick={() => setBillingMessage(null)} className="ml-3 text-xs underline">dismiss</button>
        </div>
      )}

      {billing && <BillingBanner billing={billing} onManage={handleManageBilling} />}

      <div className="aw-card mt-8 !p-2">
        <div className="space-y-0.5">
          <SettingRow icon={UserRound} label="Profile" onClick={() => setOpenModal("edit-profile")} />
          <SettingRow icon={KeyRound} label="Password & 2FA" onClick={() => setOpenModal("security")} />
          <SettingRow icon={Bell} label="Notifications" onClick={() => setOpenModal("notifications")} />
          <SettingRow icon={Cable} label="Connected accounts" onClick={() => { window.location.href = "/connect"; }} />
          <SettingRow
            icon={CreditCard}
            label="Billing"
            sublabel={billing?.planName || "No plan"}
            onClick={handleManageBilling}
          />
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
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

      {/* Danger Zone */}
      <div className="mt-12 rounded-xl border border-[var(--aw-danger)]/20 p-5">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-[var(--aw-danger)]" />
          <span className="text-sm font-semibold text-[var(--aw-danger)]">Danger zone</span>
        </div>
        <p className="mb-4 text-xs text-[var(--aw-text-muted)]">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        <DeleteAccountButton />
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
