"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Cable,
  CreditCard,
  KeyRound,
  LogOut,
  Trash2,
  UserRound,
  Menu,
  X,
  Plus,
  Monitor,
  Settings,
  Gift,
  Eye,
  Scale,
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
import { useTutorialReplay } from "@/components/plans/TutorialOrchestrator";

type SettingsSection =
  | "profile"
  | "display"
  | "notifications"
  | "security"
  | "general"
  | "members"
  | "preferences"
  | "institutions"
  | "billing"
  | "referrals"
  | "legal";

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;
    return { ...fallback, ...JSON.parse(stored) } as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// SIDEBAR NAVIGATION
// ============================================================================

interface SidebarProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
}

function Sidebar({
  activeSection,
  onSectionChange,
  isOpen,
  onClose,
  onLogout,
}: SidebarProps) {
  const sections: Array<{
    id: SettingsSection;
    label: string;
    icon: React.ElementType;
    group: "account" | "household";
  }> = [
    { id: "profile", label: "Profile", icon: UserRound, group: "account" },
    { id: "security", label: "Security", icon: KeyRound, group: "account" },
    { id: "notifications", label: "Notifications", icon: Bell, group: "account" },
    { id: "display", label: "Display", icon: Monitor, group: "account" },
    {
      id: "institutions",
      label: "Connected Banks",
      icon: Cable,
      group: "household",
    },
    { id: "billing", label: "Plan & Billing", icon: CreditCard, group: "household" },
    { id: "general", label: "General", icon: Settings, group: "household" },
    { id: "preferences", label: "Preferences", icon: Eye, group: "household" },
    { id: "referrals", label: "Invite Friends", icon: Gift, group: "household" },
    { id: "legal", label: "Privacy & Legal", icon: Scale, group: "household" },
  ];

  const accountSections = sections.filter((s) => s.group === "account");
  const householdSections = sections.filter((s) => s.group === "household");

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-50 h-screen w-64 transform bg-[var(--aw-surface-subtle)] transition-transform duration-200 lg:relative lg:z-auto lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--aw-border)] p-4">
            <h2 className="text-lg font-semibold text-[var(--aw-text)]">
              Settings
            </h2>
            <button
              onClick={onClose}
              className="rounded lg:hidden"
              type="button"
            >
              <X size={20} />
            </button>
          </div>

          {/* Account Section */}
          <div className="px-2 py-4">
            <div className="px-2 text-xs font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
              Account
            </div>
            <div className="mt-2 space-y-1">
              {accountSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => {
                    onSectionChange(section.id);
                    onClose();
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    activeSection === section.id
                      ? "bg-[var(--calico-primary)] text-[var(--calico-text)]"
                      : "text-[var(--aw-text)] hover:bg-[var(--aw-surface)]"
                  }`}
                  type="button"
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {/* Household Section */}
          <div className="border-t border-[var(--aw-border)] px-2 py-4">
            <div className="px-2 text-xs font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
              Household
            </div>
            <div className="mt-2 space-y-1">
              {householdSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => {
                    onSectionChange(section.id);
                    onClose();
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    activeSection === section.id
                      ? "bg-[var(--calico-primary)] text-[var(--calico-text)]"
                      : "text-[var(--aw-text)] hover:bg-[var(--aw-surface)]"
                  }`}
                  type="button"
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-auto border-t border-[var(--aw-border)] p-4">
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--aw-danger)] transition hover:bg-[var(--aw-danger)]/10"
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ============================================================================
// CONTENT SECTIONS
// ============================================================================

function ProfileSection({ account }: { account: AuthenticatedAccount | null }) {
  const [openModal, setOpenModal] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [savedName, setSavedName] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("calico.display-name");
      if (stored) setDisplayName(stored);
    } catch { /* ignore */ }
  }, []);

  const saveDisplayName = () => {
    const name = displayName.trim();
    try {
      if (name) {
        localStorage.setItem("calico.display-name", name);
      } else {
        localStorage.removeItem("calico.display-name");
      }
      setSavedName(true);
      setTimeout(() => setSavedName(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Profile
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Your personal information
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4">
          <div>
            <p className="text-sm font-medium text-[var(--aw-text)]">
              {account?.email || "Loading..."}
            </p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
              Email address
            </p>
          </div>
          <button
            onClick={() => setOpenModal(true)}
            className="rounded-lg px-3 py-2 text-xs font-medium transition"
            aria-label="edit-profile"
            style={{
              background: "var(--calico-card, #FFFCF8)",
              border: "1px solid var(--calico-border, #F2DECC)",
              color: "var(--aw-text)",
            }}
            type="button"
          >
            Edit
          </button>
        </div>

        <div className="rounded-lg border border-[var(--aw-border)] p-4">
          <p className="mb-2 text-xs text-[var(--aw-text-muted)]">Display name</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How should Calico call you?"
              className="aw-input flex-1 h-9 text-sm"
            />
            <button
              type="button"
              onClick={saveDisplayName}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition"
              style={{
                background: "var(--calico-primary, #FDBA74)",
                color: "var(--calico-text, #111)",
              }}
            >
              {savedName ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <EditProfileModal
        open={openModal}
        accountEmail={account?.email || ""}
        onClose={() => setOpenModal(false)}
        onSaved={() => {
          setOpenModal(false);
        }}
      />
    </div>
  );
}

function DisplaySection() {
  const [currency, setCurrency] = useState("USD");
  const [dateFormat, setDateFormat] = useState("MM/DD/YYYY");
  const [numberFormat, setNumberFormat] = useState("1,000.00");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = readStoredJson("calico.display-prefs", {
      currency: "USD",
      dateFormat: "MM/DD/YYYY",
      numberFormat: "1,000.00",
    });
    setCurrency(stored.currency);
    setDateFormat(stored.dateFormat);
    setNumberFormat(stored.numberFormat);
  }, []);

  const saveDisplayPrefs = () => {
    try {
      localStorage.setItem("calico.display-prefs", JSON.stringify({ currency, dateFormat, numberFormat }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Display
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Customize how information is displayed
        </p>
      </div>

      <div className="space-y-4">
        {/* Currency */}
        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Currency
          </label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="aw-input mt-2 w-full"
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
            <option value="CAD">CAD (C$)</option>
          </select>
        </div>

        {/* Date Format */}
        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Date Format
          </label>
          <select
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value)}
            className="aw-input mt-2 w-full"
          >
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </div>

        {/* Number Format */}
        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Number Format
          </label>
          <select
            value={numberFormat}
            onChange={(e) => setNumberFormat(e.target.value)}
            className="aw-input mt-2 w-full"
          >
            <option value="1,000.00">1,000.00</option>
            <option value="1.000,00">1.000,00</option>
            <option value="1 000,00">1 000,00</option>
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={saveDisplayPrefs}
        className="rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        {saved ? "Saved" : "Save display settings"}
      </button>
    </div>
  );
}

function NotificationsSection() {
  const [openModal, setOpenModal] = useState(false);
  const [emailWeekly, setEmailWeekly] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("calico.notification-prefs");
      if (stored) {
        const prefs = JSON.parse(stored);
        if (typeof prefs.emailWeekly === "boolean") setEmailWeekly(prefs.emailWeekly);
        if (typeof prefs.emailAlerts === "boolean") setEmailAlerts(prefs.emailAlerts);
        if (typeof prefs.pushEnabled === "boolean") setPushEnabled(prefs.pushEnabled);
      }
    } catch { /* ignore */ }
  }, []);

  const savePrefs = () => {
    try {
      localStorage.setItem("calico.notification-prefs", JSON.stringify({ emailWeekly, emailAlerts, pushEnabled }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Notifications
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Choose what Calico tells you about and how
        </p>
      </div>

      <div className="space-y-4">
        <label className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4">
          <div>
            <p className="text-sm font-medium text-[var(--aw-text)]">Weekly money recap</p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">Get a summary of your spending every week by email</p>
          </div>
          <input
            type="checkbox"
            checked={emailWeekly}
            onChange={(e) => setEmailWeekly(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--aw-border)] text-[var(--aw-primary)] focus:ring-[var(--aw-primary)]"
          />
        </label>

        <label className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4">
          <div>
            <p className="text-sm font-medium text-[var(--aw-text)]">Important alerts</p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">Unusual spending, bill increases, and payment failures</p>
          </div>
          <input
            type="checkbox"
            checked={emailAlerts}
            onChange={(e) => setEmailAlerts(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--aw-border)] text-[var(--aw-primary)] focus:ring-[var(--aw-primary)]"
          />
        </label>

        <label className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4">
          <div>
            <p className="text-sm font-medium text-[var(--aw-text)]">In-app notifications</p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">Show alerts inside Calico when something needs attention</p>
          </div>
          <input
            type="checkbox"
            checked={pushEnabled}
            onChange={(e) => setPushEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--aw-border)] text-[var(--aw-primary)] focus:ring-[var(--aw-primary)]"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={savePrefs}
        className="rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        {saved ? "Saved" : "Save preferences"}
      </button>

      <div className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--aw-text)]">Subscription operation alerts</p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
              Review cancellation and subscription-management notifications in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpenModal(true)}
            className="rounded-lg px-3 py-2 text-xs font-medium transition"
            style={{
              background: "var(--calico-card, #FFFCF8)",
              border: "1px solid var(--calico-border, #F2DECC)",
              color: "var(--aw-text)",
            }}
          >
            Manage
          </button>
        </div>
      </div>

      <NotificationSettingsModal open={openModal} onClose={() => setOpenModal(false)} />
    </div>
  );
}

function SecuritySection({
  account,
}: {
  account: AuthenticatedAccount | null;
}) {
  const [openModal, setOpenModal] = useState(false);

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Security
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Manage your password and security settings
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4">
          <div>
            <p className="text-sm font-medium text-[var(--aw-text)]">
              Password
            </p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
              ••••••••••
            </p>
          </div>
          <button
            onClick={() => setOpenModal(true)}
            className="rounded-lg px-3 py-2 text-xs font-medium transition"
            aria-label="change-password"
            style={{
              background: "var(--calico-card, #FFFCF8)",
              border: "1px solid var(--calico-border, #F2DECC)",
              color: "var(--aw-text)",
            }}
            type="button"
          >
            Change
          </button>
        </div>

        <div className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
          <p className="text-sm font-medium text-[var(--aw-text)]">
            Additional sign-in methods
          </p>
          <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
            Extra security methods will appear here when they are available for your account.
          </p>
        </div>
      </div>

      <SecuritySettingsModal
        open={openModal}
        accountEmail={account?.email || ""}
        initialPanel="password"
        onClose={() => setOpenModal(false)}
      />
    </div>
  );
}

function GeneralSection() {
  const [household, setHousehold] = useState("My Household");
  const [country, setCountry] = useState("US");
  const [currency, setCurrency] = useState("USD");
  const [saved, setSaved] = useState(false);
  const { replay } = useTutorialReplay();

  useEffect(() => {
    const stored = readStoredJson("calico.general-prefs", {
      household: "My Household",
      country: "US",
      currency: "USD",
    });
    setHousehold(stored.household);
    setCountry(stored.country);
    setCurrency(stored.currency);
  }, []);

  const saveGeneralPrefs = () => {
    try {
      localStorage.setItem("calico.general-prefs", JSON.stringify({ household, country, currency }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          General
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Household settings
        </p>
      </div>

      <div className="rounded-lg border border-[var(--aw-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--aw-text)]">Product tutorial</p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
              Replay the guided tour of Calico and your plan features
            </p>
          </div>
          <button
            type="button"
            onClick={replay}
            className="rounded-lg px-3 py-2 text-xs font-medium transition"
            style={{
              background: "var(--calico-card, #FFFCF8)",
              border: "1px solid var(--calico-border, #F2DECC)",
              color: "var(--aw-text)",
            }}
          >
            Replay
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Household name
          </label>
          <input
            type="text"
            value={household}
            onChange={(e) => setHousehold(e.target.value)}
            className="aw-input mt-2 w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Country
          </label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="aw-input mt-2 w-full"
          >
            <option value="US">United States</option>
            <option value="CA">Canada</option>
            <option value="UK">United Kingdom</option>
            <option value="AU">Australia</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Primary currency
          </label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="aw-input mt-2 w-full"
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
            <option value="CAD">CAD (C$)</option>
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={saveGeneralPrefs}
        className="rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        {saved ? "Saved" : "Save general settings"}
      </button>
    </div>
  );
}

function MembersSection({ account, billing }: { account: AuthenticatedAccount | null; billing: BillingStatus | null }) {
  const plan = billing?.plan ?? null;
  const maxMembers = plan === "autonomous" ? 5 : 2;
  const memberCount = 1; // Owner is always 1 member

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">Members</h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Share your household with up to {maxMembers} people{plan === "autonomous" ? " on the Autonomous plan" : ""}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-[var(--calico-primary)] text-center leading-8 text-[var(--calico-text)] text-sm font-semibold">
              {(account?.email ?? "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--aw-text)]">
                {account?.email ?? "Loading..."}
              </p>
              <p className="text-xs text-[var(--aw-text-muted)]">Owner</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
          <p className="text-sm text-[var(--aw-text-muted)]">
            Shared households are not open in this build yet. Your plan support will apply automatically when invites are available ({memberCount}/{maxMembers} used).
          </p>
        </div>
      </div>
    </div>
  );
}

function PreferencesSection() {
  const [transactionView, setTransactionView] = useState("date");
  const [firstDay, setFirstDay] = useState("sunday");
  const [fiscalYear, setFiscalYear] = useState("january");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = readStoredJson("calico.preferences", {
      transactionView: "date",
      firstDay: "sunday",
      fiscalYear: "january",
    });
    setTransactionView(stored.transactionView);
    setFirstDay(stored.firstDay);
    setFiscalYear(stored.fiscalYear);
  }, []);

  const savePreferences = () => {
    try {
      localStorage.setItem("calico.preferences", JSON.stringify({ transactionView, firstDay, fiscalYear }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Preferences
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Customize default behaviors
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Default transaction view
          </label>
          <select
            value={transactionView}
            onChange={(e) => setTransactionView(e.target.value)}
            className="aw-input mt-2 w-full"
          >
            <option value="date">By date</option>
            <option value="category">By category</option>
            <option value="account">By account</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            First day of week
          </label>
          <select
            value={firstDay}
            onChange={(e) => setFirstDay(e.target.value)}
            className="aw-input mt-2 w-full"
          >
            <option value="sunday">Sunday</option>
            <option value="monday">Monday</option>
            <option value="saturday">Saturday</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Fiscal year start
          </label>
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="aw-input mt-2 w-full"
          >
            <option value="january">January</option>
            <option value="april">April</option>
            <option value="july">July</option>
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={savePreferences}
        className="rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        {saved ? "Saved" : "Save preferences"}
      </button>
    </div>
  );
}

function InstitutionsSection() {
  const router = useRouter();

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Connected Banks
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Manage your connected financial accounts
        </p>
      </div>

      <button
        type="button"
        onClick={() => router.push("/connect")}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        <Plus size={16} />
        Connect an account
      </button>

      <div className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
        <p className="text-sm text-[var(--aw-text-muted)]">
          Your connected accounts are managed in the Accounts page. Use the button above to connect a new bank or card.
        </p>
      </div>
    </div>
  );
}

const PLAN_DISPLAY: Record<PlanId, { name: string; price: string; description: string; bestFor: string }> = {
  starter: { name: "Starter", price: "$8.99/mo", description: "See where you stand", bestFor: "Best for getting organized" },
  pro: { name: "Pro", price: "$29.99/mo", description: "Understand what to do next", bestFor: "Best for smarter money decisions" },
  autonomous: { name: "Fully Autonomous", price: "$89.99/mo", description: "Let Calico handle it", bestFor: "Best for active financial optimization" },
};

function BillingSection({
  billing,
  onManage,
}: {
  billing: BillingStatus | null;
  onManage: () => void;
}) {
  const currentPlan = billing?.plan ?? null;

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">Plan & Billing</h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Manage your subscription, upgrade, or downgrade your plan
        </p>
      </div>

      {/* Current plan status */}
      {billing ? (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
              Current plan
            </p>
            <p className="mt-1 text-base font-semibold text-[var(--aw-text)]">
              {billing.planName}
            </p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
              ${billing.priceMonthly}/month
              {billing.status === "active" && !billing.cancelAtPeriodEnd && (
                <span className="ml-2 text-green-600">Active</span>
              )}
            </p>
          </div>
          <button
            onClick={onManage}
            type="button"
            className="shrink-0 rounded-lg px-4 py-2 text-xs font-medium transition"
            style={{
              background: "var(--calico-card, #FFFCF8)",
              border: "1px solid var(--calico-border, #F2DECC)",
              color: "var(--aw-text)",
            }}
          >
            Manage billing
          </button>
        </div>
      ) : null}

      {/* Plan options */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
          {currentPlan ? "Change plan" : "Choose a plan"}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["starter", "pro", "autonomous"] as PlanId[]).map((planId) => {
            const plan = PLAN_DISPLAY[planId];
            const isCurrent = planId === currentPlan;
            return (
              <button
                key={planId}
                type="button"
                onClick={() => {
                  if (!isCurrent) void startCheckout(planId);
                }}
                disabled={isCurrent}
                className="relative flex flex-col items-start rounded-xl border p-4 text-left transition hover:border-[var(--aw-primary)] disabled:cursor-default disabled:opacity-100"
                style={{
                  borderColor: isCurrent
                    ? "var(--aw-primary)"
                    : "var(--aw-border)",
                  background: isCurrent
                    ? "rgba(253,186,116,0.08)"
                    : "var(--aw-surface-1)",
                }}
              >
                {isCurrent && (
                  <span className="absolute right-3 top-3 rounded-full bg-[var(--aw-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--aw-text)]">
                    Current
                  </span>
                )}
                <p className="text-sm font-semibold text-[var(--aw-text)]">{plan.name}</p>
                <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">{plan.price}</p>
                <p className="mt-2 text-xs leading-relaxed text-[var(--aw-text-muted)]">{plan.description}</p>
                {!isCurrent && (
                  <span className="mt-3 text-xs font-semibold text-[var(--aw-primary)]">
                    {currentPlan && (["starter", "pro", "autonomous"].indexOf(planId) < ["starter", "pro", "autonomous"].indexOf(currentPlan))
                      ? "Downgrade"
                      : "Upgrade"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ReferralsSection({ account }: { account: AuthenticatedAccount | null }) {
  const [copied, setCopied] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [stats, setStats] = useState<{
    referralCode: string;
    referralLink: string;
    monthlyConversions: number;
    currentTier: string;
    conversionsToNextTier: number;
    monthlyEarnings: number;
    totalEarnings: number;
    pendingSignups: number;
  } | null>(null);

  useEffect(() => {
    if (!account) {
      setStatsLoading(false);
      return;
    }
    setStatsLoading(true);
    fetch('/api/referrals')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.stats) setStats(data.stats);
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [account]);

  const referralLink = stats?.referralLink ?? null;

  const copyToClipboard = () => {
    if (!referralLink) return;
    void navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Refer friends, earn commission
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Earn 50% commission on each referral. Hit 10 in a month and earn 100% on every referral after that.
        </p>
      </div>

      {/* Progress toward 100% tier */}
      {stats ? (
        <div className="rounded-xl border border-[var(--calico-primary,#FDBA74)]/30 bg-[rgba(253,186,116,0.08)] p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[var(--aw-text)]">
              {stats.monthlyConversions} of 10 referrals this month
            </p>
            <span className="rounded-full bg-[var(--calico-primary,#FDBA74)] px-2.5 py-0.5 text-xs font-bold text-[var(--aw-text)]">
              {stats.currentTier}
            </span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-[var(--aw-border)]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (stats.monthlyConversions / 10) * 100)}%`,
                backgroundColor: stats.monthlyConversions >= 10 ? 'var(--aw-success)' : 'var(--calico-primary, #FDBA74)',
              }}
            />
          </div>
          {stats.conversionsToNextTier > 0 ? (
            <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
              {stats.conversionsToNextTier} more to unlock 100% commission this month
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--aw-success)]">
              You&apos;ve unlocked 100% commission this month!
            </p>
          )}
        </div>
      ) : null}

      {/* Earnings summary */}
      {stats ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-[var(--aw-surface-1)] p-3 text-center">
            <p className="text-lg font-semibold text-[var(--aw-text)]">{fmt(stats.monthlyEarnings)}</p>
            <p className="text-[10px] text-[var(--aw-text-muted)]">This month</p>
          </div>
          <div className="rounded-xl bg-[var(--aw-surface-1)] p-3 text-center">
            <p className="text-lg font-semibold text-[var(--aw-text)]">{fmt(stats.totalEarnings)}</p>
            <p className="text-[10px] text-[var(--aw-text-muted)]">All time</p>
          </div>
          <div className="rounded-xl bg-[var(--aw-surface-1)] p-3 text-center">
            <p className="text-lg font-semibold text-[var(--aw-text)]">{stats.pendingSignups}</p>
            <p className="text-[10px] text-[var(--aw-text-muted)]">Pending</p>
          </div>
        </div>
      ) : null}

      {/* Commission examples */}
      <div className="rounded-xl border border-[var(--aw-border)] p-4">
        <p className="mb-2 text-sm font-semibold text-[var(--aw-text)]">Commission rates</p>
        <div className="space-y-1.5 text-xs text-[var(--aw-text-muted)]">
          <div className="flex justify-between"><span>Starter (before 10)</span><span className="font-semibold text-[var(--aw-text)]">$4.50</span></div>
          <div className="flex justify-between"><span>Starter (after 10)</span><span className="font-semibold text-[var(--aw-success)]">$8.99</span></div>
          <div className="flex justify-between"><span>Pro (before 10)</span><span className="font-semibold text-[var(--aw-text)]">$14.00</span></div>
          <div className="flex justify-between"><span>Pro (after 10)</span><span className="font-semibold text-[var(--aw-success)]">$27.99</span></div>
          <div className="flex justify-between"><span>Autonomous (before 10)</span><span className="font-semibold text-[var(--aw-text)]">$45.00</span></div>
          <div className="flex justify-between"><span>Autonomous (after 10)</span><span className="font-semibold text-[var(--aw-success)]">$89.99</span></div>
        </div>
      </div>

      {/* Referral link */}
      {referralLink ? (
        <div>
          <p className="mb-2 text-xs text-[var(--aw-text-muted)]">Your referral link</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={referralLink}
              readOnly
              className="aw-input flex-1 text-sm"
            />
            <button
              onClick={copyToClipboard}
              type="button"
              className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition"
              style={{
                background: "var(--calico-primary, #FDBA74)",
                color: "var(--calico-text, #111)",
              }}
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </div>
      ) : statsLoading ? (
        <p className="text-sm text-[var(--aw-text-muted)]">
          Loading your referral link...
        </p>
      ) : !account ? (
        <p className="text-sm text-[var(--aw-text-muted)]">
          Sign in to get your referral link.
        </p>
      ) : (
        <p className="text-sm text-[var(--aw-text-muted)]">
          Unable to load referral link. Try refreshing the page.
        </p>
      )}
    </div>
  );
}

function DeleteAccountButton() {
  const [step, setStep] = useState<"idle" | "warn" | "confirm">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (confirmText !== "DELETE") return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount({ confirmText });
      try { localStorage.clear(); } catch { /* ignore */ }
      try { sessionStorage.clear(); } catch { /* ignore */ }
      window.location.href = "/login?accountDeleted=1";
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Deletion failed");
      setIsDeleting(false);
    }
  };

  const reset = () => {
    setStep("idle");
    setConfirmText("");
    setDeleteError(null);
  };

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("warn")}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-[var(--aw-danger)] transition hover:bg-[var(--aw-danger)]/10"
      >
        <Trash2 size={13} />
        Delete account
      </button>
    );
  }

  if (step === "warn") {
    return (
      <div className="space-y-3 rounded-xl border border-[var(--aw-danger)]/20 bg-[var(--aw-danger)]/5 p-4">
        <p className="text-sm font-semibold text-[var(--aw-danger)]">
          Are you sure?
        </p>
        <p className="text-xs leading-5 text-[var(--aw-text-muted)]">
          This will permanently delete your Calico account, all connected accounts, transactions,
          budgets, goals, and settings. This action cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep("confirm")}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition"
            style={{ background: "var(--aw-danger)" }}
          >
            I understand, continue
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--aw-text-muted)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--aw-danger)]/20 bg-[var(--aw-danger)]/5 p-4">
      <p className="text-xs font-medium text-[var(--aw-danger)]">
        Type <strong>DELETE</strong> to permanently delete your account:
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="DELETE"
        className="aw-input h-9 w-full text-xs"
        autoComplete="off"
        style={{ borderColor: "var(--aw-danger)" }}
      />
      {deleteError && (
        <p className="text-xs text-[var(--aw-danger)]">{deleteError}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={confirmText !== "DELETE" || isDeleting}
          className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
          style={{ background: "var(--aw-danger)" }}
        >
          {isDeleting ? "Deleting..." : "Permanently delete my account"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--aw-text-muted)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN SETTINGS PAGE
// ============================================================================

export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");
  const [account, setAccount] = useState<AuthenticatedAccount | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
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
      // silent
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
    void refreshBilling();
  }, [refreshAccount, refreshBilling]);

  // Deep-link to a section via ?section=billing etc.
  useEffect(() => {
    const sectionParam = searchParams.get("section");
    if (sectionParam && ["profile", "display", "notifications", "security", "general", "members", "preferences", "institutions", "billing", "referrals"].includes(sectionParam)) {
      setActiveSection(sectionParam as SettingsSection);
    }
  }, [searchParams]);

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
    <div className="flex h-screen bg-[var(--aw-surface)]">
      {/* Sidebar */}
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={() => { void onLogout(); }}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="border-b border-[var(--aw-border)] bg-[var(--aw-surface)] p-6">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="rounded lg:hidden"
              >
                <Menu size={24} />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-[var(--aw-text)]">
                  Settings
                </h1>
                {account?.email && (
                  <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
                    {account.email}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Billing Message */}
          {billingMessage && (
            <div className="mx-6 mt-6 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(253,186,116,0.18)", border: "1px solid var(--calico-primary, #FDBA74)", color: "var(--calico-text, #111)" }}>
              {billingMessage}
              <button type="button" onClick={() => setBillingMessage(null)} className="ml-3 text-xs underline">
                dismiss
              </button>
            </div>
          )}

          {/* Content */}
          <div className="p-6">
            {activeSection === "profile" && (
              <ProfileSection account={account} />
            )}
            {activeSection === "display" && <DisplaySection />}
            {activeSection === "notifications" && <NotificationsSection />}
            {activeSection === "security" && (
              <SecuritySection account={account} />
            )}
            {activeSection === "general" && <GeneralSection />}
            {activeSection === "members" && <MembersSection account={account} billing={billing} />}
            {activeSection === "preferences" && <PreferencesSection />}
            {activeSection === "institutions" && <InstitutionsSection />}
            {activeSection === "billing" && (
              <BillingSection billing={billing} onManage={handleManageBilling} />
            )}
            {activeSection === "referrals" && <ReferralsSection account={account} />}

            {activeSection === "legal" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--aw-text)]">Privacy & Legal</h3>
                  <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
                    How Calico handles your data and your rights.
                  </p>
                </div>

                <div className="space-y-3">
                  <a
                    href="https://www.freeprivacypolicy.com/live/ab2b2a8a-1946-4178-ad49-1cde9a62f587"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3.5 transition hover:border-[var(--aw-primary)]/30 hover:bg-[var(--aw-primary-soft)]/20"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--aw-text)]">Privacy Policy</p>
                      <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">How we collect, use, and protect your information.</p>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--aw-text-muted)]">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>

                <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-4 py-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">
                    Calico uses bank-level encryption to protect your financial data. Your credentials are never stored on our servers — all connections are handled securely through Plaid.
                  </p>
                </div>
              </div>
            )}

            {/* Logout & Danger Zone - Always visible */}
            {activeSection === "profile" && (
              <>
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
                    <AlertTriangle
                      size={16}
                      className="text-[var(--aw-danger)]"
                    />
                    <span className="text-sm font-semibold text-[var(--aw-danger)]">
                      Danger zone
                    </span>
                  </div>
                  <p className="mb-4 text-xs text-[var(--aw-text-muted)]">
                    Permanently delete your account and all associated data.
                    This action cannot be undone.
                  </p>
                  <DeleteAccountButton />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
