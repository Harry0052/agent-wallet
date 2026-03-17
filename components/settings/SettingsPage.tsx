"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
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
  Edit2,
  Trash,
  Moon,
  Sun,
  Monitor,
  Users,
  Settings,
  Database,
  Gift,
  Tag,
  Zap,
  Eye,
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

type SettingsSection =
  | "profile"
  | "display"
  | "notifications"
  | "security"
  | "general"
  | "members"
  | "preferences"
  | "institutions"
  | "categories"
  | "merchants"
  | "rules"
  | "tags"
  | "data"
  | "billing"
  | "referrals";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Institution {
  id: string;
  name: string;
  accounts: number;
}

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
    { id: "categories", label: "Spending Groups", icon: Tag, group: "household" },
    {
      id: "merchants",
      label: "Stores & Services",
      icon: Zap,
      group: "household",
    },
    { id: "rules", label: "Auto-Rules", icon: Zap, group: "household" },
    { id: "tags", label: "Labels", icon: Tag, group: "household" },
    { id: "data", label: "Your Data", icon: Database, group: "household" },
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

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Profile
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Edit your personal information
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
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
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
        {/* Theme */}
        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Theme
          </label>
          <div className="mt-2 flex gap-2">
            {[
              { value: "light" as const, label: "Light", icon: Sun },
              { value: "dark" as const, label: "Dark", icon: Moon },
              { value: "system" as const, label: "System", icon: Monitor },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  theme === value
                    ? "bg-[var(--calico-primary)] text-[var(--calico-text)]"
                    : "border border-[var(--aw-border)] text-[var(--aw-text)] hover:bg-[var(--aw-surface)]"
                }`}
                type="button"
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
        </div>

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
  const [openModal, setOpenModal] = useState(false);

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Notifications
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Control when and how we notify you
        </p>
      </div>

      <button
        onClick={() => setOpenModal(true)}
        className="rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
        type="button"
      >
        Manage notification preferences
      </button>

      <NotificationSettingsModal
        open={openModal}
        onClose={() => setOpenModal(false)}
      />
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
              Not enabled
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
            Enable
          </button>
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

function MembersSection() {
  const [members] = useState([
    { id: "1", email: "you@example.com", role: "Owner" },
  ]);
  const [inviteEmail, setInviteEmail] = useState("");

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">Members</h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Manage household members
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="Enter email to invite"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="aw-input flex-1"
          />
          <button
            type="button"
            className="rounded-lg px-4 py-2 font-medium transition"
            style={{
              background: "var(--calico-primary, #FDBA74)",
              color: "var(--calico-text, #111)",
            }}
          >
            Invite
          </button>
        </div>

        <div className="border-t border-[var(--aw-border)] pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
            Members
          </h4>
          <div className="mt-3 space-y-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-[var(--calico-primary)] text-center leading-8 text-[var(--calico-text)] text-sm font-semibold">
                    {member.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--aw-text)]">
                      {member.email}
                    </p>
                    <p className="text-xs text-[var(--aw-text-muted)]">
                      {member.role}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
  const [institutions] = useState<Institution[]>([
    { id: "1", name: "Chase Bank", accounts: 2 },
    { id: "2", name: "Fidelity", accounts: 1 },
  ]);

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Institutions
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Manage connected financial institutions
        </p>
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        <Plus size={16} />
        Add institution
      </button>

      <div className="space-y-2">
        {institutions.map((inst) => (
          <div
            key={inst.id}
            className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4"
          >
            <div>
              <p className="text-sm font-medium text-[var(--aw-text)]">
                {inst.name}
              </p>
              <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                {inst.accounts} account{inst.accounts !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium transition"
              style={{
                background: "var(--calico-card, #FFFCF8)",
                border: "1px solid var(--calico-border, #F2DECC)",
                color: "var(--aw-text)",
              }}
            >
              Refresh
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoriesSection() {
  const categoryGroups = useMemo(() => {
    const income = [
      { id: "1", name: "Paychecks", emoji: "💰" },
      { id: "2", name: "Interest", emoji: "📈" },
      { id: "3", name: "Business Income", emoji: "💼" },
      { id: "4", name: "Other Income", emoji: "🎁" },
    ];

    const expenses: Record<string, { id: string; name: string; emoji: string }[]> = {
      "Gifts & Donations": [
        { id: "101", name: "Charity", emoji: "🤝" },
        { id: "102", name: "Gifts", emoji: "🎁" },
      ],
      "Auto & Transport": [
        { id: "201", name: "Auto Payment", emoji: "🚗" },
        { id: "202", name: "Public Transit", emoji: "🚇" },
      ],
      Children: [
        { id: "301", name: "Child Care", emoji: "👶" },
        { id: "302", name: "Child Activities", emoji: "🎨" },
      ],
      Education: [
        { id: "401", name: "Student Loans", emoji: "📚" },
        { id: "402", name: "Education", emoji: "🎓" },
      ],
      "Health & Wellness": [
        { id: "501", name: "Medical", emoji: "🏥" },
        { id: "502", name: "Dentist", emoji: "🦷" },
        { id: "503", name: "Fitness", emoji: "💪" },
      ],
      Financial: [{ id: "601", name: "Loan Repayment", emoji: "💳" }],
      "Food & Drink": [
        { id: "701", name: "Groceries", emoji: "🛒" },
        { id: "702", name: "Restaurants", emoji: "🍽️" },
      ],
      Entertainment: [
        { id: "801", name: "Movies", emoji: "🎬" },
        { id: "802", name: "Games", emoji: "🎮" },
      ],
      Home: [
        { id: "901", name: "Rent", emoji: "🏠" },
        { id: "902", name: "Utilities", emoji: "⚡" },
      ],
      Personal: [
        { id: "1001", name: "Clothing", emoji: "👕" },
        { id: "1002", name: "Personal Care", emoji: "💇" },
      ],
      Shopping: [{ id: "1101", name: "Shopping", emoji: "🛍️" }],
      Travel: [
        { id: "1201", name: "Flights", emoji: "✈️" },
        { id: "1202", name: "Hotels", emoji: "🏨" },
      ],
    };

    return { income, expenses };
  }, []);

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Categories
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Organize your transactions
        </p>
      </div>

      {/* Income */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-[var(--aw-text)]">
            Income
          </h4>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--calico-primary)]"
          >
            <Plus size={14} />
            New group
          </button>
        </div>
        <div className="space-y-2">
          {categoryGroups.income.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{cat.emoji}</span>
                <p className="text-sm font-medium text-[var(--aw-text)]">
                  {cat.name}
                </p>
              </div>
              <button
                type="button"
                className="rounded text-[var(--aw-text-muted)] hover:text-[var(--aw-text)]"
              >
                <Edit2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="w-full rounded-lg border border-dashed border-[var(--aw-border)] py-2 text-sm font-medium text-[var(--aw-text-muted)] transition hover:bg-[var(--aw-surface)]"
          >
            <Plus size={14} className="inline mr-1" />
            Add category
          </button>
        </div>
      </div>

      {/* Expenses */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-[var(--aw-text)]">
            Expenses
          </h4>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--calico-primary)]"
          >
            <Plus size={14} />
            New group
          </button>
        </div>
        <div className="space-y-4">
          {Object.entries(categoryGroups.expenses).map(([group, cats]) => (
            <div key={group}>
              <div className="mb-2 flex items-center justify-between">
                <h5 className="text-xs font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
                  {group}
                </h5>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--aw-danger)]"
                >
                  Delete group
                </button>
              </div>
              <div className="space-y-2">
                {cats.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cat.emoji}</span>
                      <p className="text-sm font-medium text-[var(--aw-text)]">
                        {cat.name}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded text-[var(--aw-text-muted)] hover:text-[var(--aw-text)]"
                    >
                      <Edit2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="w-full rounded-lg border border-dashed border-[var(--aw-border)] py-2 text-sm font-medium text-[var(--aw-text-muted)] transition hover:bg-[var(--aw-surface)]"
                >
                  <Plus size={14} className="inline mr-1" />
                  Add category
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MerchantsSection() {
  const [merchants] = useState([
    { id: "1", name: "Starbucks", category: "Coffee" },
    { id: "2", name: "Whole Foods", category: "Groceries" },
  ]);

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Merchants
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Manage merchant rules and mappings
        </p>
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        <Plus size={16} />
        Add merchant
      </button>

      <div className="space-y-2">
        {merchants.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4"
          >
            <div>
              <p className="text-sm font-medium text-[var(--aw-text)]">
                {m.name}
              </p>
              <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                {m.category}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium transition"
              style={{
                background: "var(--calico-card, #FFFCF8)",
                border: "1px solid var(--calico-border, #F2DECC)",
                color: "var(--aw-text)",
              }}
            >
              Edit
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RulesSection() {
  const [rules] = useState([
    {
      id: "1",
      condition: "Merchant contains 'STARBUCKS'",
      action: "Set category to Coffee",
    },
    {
      id: "2",
      condition: "Amount > $100",
      action: "Add tag 'Splurge'",
    },
  ]);

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">Rules</h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Auto-categorization and tagging rules
        </p>
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        <Plus size={16} />
        Create rule
      </button>

      <div className="space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4"
          >
            <div>
              <p className="text-sm font-medium text-[var(--aw-text)]">
                {rule.condition}
              </p>
              <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                {rule.action}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium transition"
              style={{
                background: "var(--calico-card, #FFFCF8)",
                border: "1px solid var(--calico-border, #F2DECC)",
                color: "var(--aw-text)",
              }}
            >
              Edit
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TagsSection() {
  const [tags] = useState<Tag[]>([
    { id: "1", name: "Tax", color: "#3b82f6" },
    { id: "2", name: "Reimburse", color: "#06b6d4" },
    { id: "3", name: "Split", color: "#10b981" },
    { id: "4", name: "Business", color: "#f97316" },
    { id: "5", name: "Subscription", color: "#eab308" },
  ]);

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">Tags</h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Organize transactions with custom tags
        </p>
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
        style={{
          background: "var(--calico-primary, #FDBA74)",
          color: "var(--calico-text, #111)",
        }}
      >
        <Plus size={16} />
        New tag
      </button>

      <div className="space-y-2">
        {tags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center justify-between rounded-lg border border-[var(--aw-border)] p-4"
          >
            <div className="flex items-center gap-3">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <p className="text-sm font-medium text-[var(--aw-text)]">
                {tag.name}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded text-[var(--aw-text-muted)] hover:text-[var(--aw-text)]"
              >
                <Edit2 size={14} />
              </button>
              <button
                type="button"
                className="rounded text-[var(--aw-text-muted)] hover:text-[var(--aw-danger)]"
              >
                <Trash size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataSection() {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteDate, setDeleteDate] = useState("");

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">Data</h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Manage your data
        </p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--aw-border)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--aw-text)]">
                Delete transaction history
              </p>
              <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                Remove transactions before a certain date
              </p>
            </div>
            <button
              onClick={() => setShowDeleteModal(true)}
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium transition"
              style={{
                background: "var(--aw-danger)",
                color: "white",
              }}
            >
              Delete
            </button>
          </div>

          {showDeleteModal && (
            <div className="mt-4 space-y-3 border-t border-[var(--aw-border)] pt-4">
              <input
                type="date"
                value={deleteDate}
                onChange={(e) => setDeleteDate(e.target.value)}
                className="aw-input w-full"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition"
                  style={{
                    background: "var(--aw-danger)",
                    color: "white",
                  }}
                >
                  Delete transactions
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  type="button"
                  className="flex-1 rounded-lg border border-[var(--aw-border)] px-3 py-2 text-sm font-medium transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--aw-border)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--aw-text)]">
                Delete account balance snapshots
              </p>
              <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                Remove all historical balance data
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium transition"
              style={{
                background: "var(--aw-danger)",
                color: "white",
              }}
            >
              Delete
            </button>
          </div>
        </div>
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

function ReferralsSection() {
  const [referralLink] = useState(
    "https://calico.app/ref/abc123def456"
  );
  const [stats] = useState({
    earned: 2,
    pending: 1,
    completed: 5,
  });

  const copyToClipboard = () => {
    void navigator.clipboard.writeText(referralLink);
  };

  return (
    <div className="aw-card space-y-6 !p-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--aw-text)]">
          Referrals
        </h3>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Share Calico and earn rewards
        </p>
      </div>

      <div className="space-y-4">
        {/* Share Link */}
        <div>
          <label className="text-sm font-medium text-[var(--aw-text)]">
            Your referral link
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={referralLink}
              readOnly
              className="aw-input flex-1"
            />
            <button
              onClick={copyToClipboard}
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium transition"
              style={{
                background: "var(--calico-primary, #FDBA74)",
                color: "var(--calico-text, #111)",
              }}
            >
              Copy
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[var(--aw-border)] p-3 text-center">
            <p className="text-2xl font-bold text-[var(--calico-primary)]">
              {stats.earned}
            </p>
            <p className="mt-1 text-xs font-medium text-[var(--aw-text-muted)]">
              Earned
            </p>
          </div>
          <div className="rounded-lg border border-[var(--aw-border)] p-3 text-center">
            <p className="text-2xl font-bold text-[var(--aw-text)]">
              {stats.pending}
            </p>
            <p className="mt-1 text-xs font-medium text-[var(--aw-text-muted)]">
              Pending
            </p>
          </div>
          <div className="rounded-lg border border-[var(--aw-border)] p-3 text-center">
            <p className="text-2xl font-bold text-[var(--aw-text)]">
              {stats.completed}
            </p>
            <p className="mt-1 text-xs font-medium text-[var(--aw-text-muted)]">
              Completed
            </p>
          </div>
        </div>
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
            {activeSection === "members" && <MembersSection />}
            {activeSection === "preferences" && <PreferencesSection />}
            {activeSection === "institutions" && <InstitutionsSection />}
            {activeSection === "categories" && <CategoriesSection />}
            {activeSection === "merchants" && <MerchantsSection />}
            {activeSection === "rules" && <RulesSection />}
            {activeSection === "tags" && <TagsSection />}
            {activeSection === "data" && <DataSection />}
            {activeSection === "billing" && (
              <BillingSection billing={billing} onManage={handleManageBilling} />
            )}
            {activeSection === "referrals" && <ReferralsSection />}

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
