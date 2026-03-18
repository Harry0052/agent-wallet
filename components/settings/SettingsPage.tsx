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
  Users,
  Settings,
  Gift,
  Eye,
} from "lucide-react";
import { EditProfileModal } from "@/modals/EditProfileModal";
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
  | "referrals";

// ============================================================================
// SIDEBAR NAVIGATION
// ============================================================================

interface SidebarProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  isOpen: boolean;
  onClose: () => void;
}

function Sidebar({
  activeSection,
  onSectionChange,
  isOpen,
  onClose,
}: SidebarProps) {
  const sections: Array<{
    id: SettingsSection;
    label: string;
    icon: React.ElementType;
    group: "account" | "household";
  }> = [
    // Account
    { id: "profile", label: "Profile", icon: UserRound, group: "account" },
    { id: "display", label: "Display", icon: Monitor, group: "account" },
    {
      id: "notifications",
      label: "Notifications",
      icon: Bell,
      group: "account",
    },
    { id: "security", label: "Security", icon: KeyRound, group: "account" },
    // Household
    { id: "general", label: "General", icon: Settings, group: "household" },
    { id: "members", label: "Members", icon: Users, group: "household" },
    {
      id: "preferences",
      label: "Preferences",
      icon: Eye,
      group: "household",
    },
    {
      id: "institutions",
      label: "Connected Banks",
      icon: Cable,
      group: "household",
    },
    { id: "billing", label: "Plan & Billing", icon: CreditCard, group: "household" },
    { id: "referrals", label: "Invite Friends", icon: Gift, group: "household" },
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
    </div>
  );
}

function NotificationsSection() {
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

        <div className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4">
          <div>
            <p className="text-sm font-medium text-[var(--aw-text)]">
              Two-factor authentication
            </p>
            <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
              Authenticator app and email 2FA are coming soon
            </p>
          </div>
          <span className="rounded-lg border border-[var(--aw-border)] px-3 py-2 text-xs font-medium text-[var(--aw-text-muted)]">
            Coming soon
          </span>
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
            Household invitations are coming soon. Your plan supports up to {maxMembers} members ({memberCount}/{maxMembers} used).
          </p>
          {plan !== "autonomous" && (
            <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
              Upgrade to the Autonomous plan for up to 5 household members.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PreferencesSection() {
  const [transactionView, setTransactionView] = useState("date");
  const [firstDay, setFirstDay] = useState("sunday");
  const [fiscalYear, setFiscalYear] = useState("january");

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

function BillingSection({
  billing,
  onManage,
}: {
  billing: BillingStatus | null;
  onManage: () => void;
}) {
  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">Billing</h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Manage your subscription and plans
        </p>
      </div>

      {billing ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--aw-border)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
              Current plan
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--aw-text)]">
              {billing.planName}
            </p>
            <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
              ${billing.priceMonthly}/month
            </p>
            <button
              onClick={onManage}
              type="button"
              className="mt-4 rounded-lg px-4 py-2 text-sm font-medium transition"
              style={{
                background: "var(--calico-card, #FFFCF8)",
                border: "1px solid var(--calico-border, #F2DECC)",
                color: "var(--aw-text)",
              }}
            >
              Manage billing
            </button>
          </div>

          {billing.status === "active" && !billing.cancelAtPeriodEnd && (
            <div className="rounded-lg border border-[var(--aw-border)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
                Status
              </p>
              <p className="mt-2 text-sm font-medium text-green-600">
                ✓ Active
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--calico-border)] bg-[var(--calico-card)] p-4">
          <p className="text-sm font-medium text-[var(--aw-text)]">
            No active plan
          </p>
          <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
            Subscribe to unlock all features
          </p>
          <div className="mt-3 flex gap-2">
            {(["starter", "pro", "autonomous"] as PlanId[]).map((plan) => (
              <button
                key={plan}
                type="button"
                onClick={() => {
                  void startCheckout(plan);
                }}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition"
                style={{
                  background:
                    plan === "pro"
                      ? "var(--calico-primary, #FDBA74)"
                      : "var(--calico-card, #FFFCF8)",
                  color: "var(--calico-text, #111)",
                  border:
                    plan === "pro"
                      ? "none"
                      : "1px solid var(--calico-border, #F2DECC)",
                }}
              >
                {plan === "starter"
                  ? "Start Free Trial"
                  : plan === "pro"
                    ? "Subscribe Pro"
                    : "Autonomous"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReferralsSection({ account }: { account: AuthenticatedAccount | null }) {
  const [copied, setCopied] = useState(false);

  // Generate a stable referral code from the user's ID
  const referralCode = account?.appUserId
    ? account.appUserId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase()
    : null;
  const referralLink = referralCode
    ? `https://calico.app/ref/${referralCode}`
    : null;

  const copyToClipboard = () => {
    if (!referralLink) return;
    void navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Invite a friend, they get 50% off
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Share your link and the person who signs up gets 50% off their first month on any plan.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--calico-primary,#FDBA74)]/30 bg-[rgba(253,186,116,0.08)] p-4">
        <p className="text-sm font-semibold text-[var(--aw-text)]">How it works</p>
        <ol className="mt-2 space-y-1.5 text-sm text-[var(--aw-text-muted)]">
          <li className="flex gap-2">
            <span className="shrink-0 font-semibold text-[var(--calico-primary,#FDBA74)]">1.</span>
            Share your referral link with a friend
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 font-semibold text-[var(--calico-primary,#FDBA74)]">2.</span>
            They sign up and pick a plan
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 font-semibold text-[var(--calico-primary,#FDBA74)]">3.</span>
            They get 50% off their first month automatically
          </li>
        </ol>
      </div>

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
      ) : (
        <p className="text-sm text-[var(--aw-text-muted)]">
          Sign in to get your referral link.
        </p>
      )}
    </div>
  );
}

function DeleteAccountButton() {
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
      // Clear all local data before redirecting
      try { localStorage.clear(); } catch { /* ignore */ }
      try { sessionStorage.clear(); } catch { /* ignore */ }
      // Full page redirect to clear all client state
      window.location.href = "/login?accountDeleted=1";
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
          onClick={() => {
            setShowConfirm(false);
            setConfirmText("");
          }}
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
