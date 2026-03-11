"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { SettingsPanel } from "@/components/SettingsPanel";
import { fmtFull } from "@/lib/utils";
import type {
  ActiveSubscriptionTask,
  SubscriptionActionRecord,
  UserAutofillProfile,
} from "@/lib/types";
import { requestPasswordReset, logout } from "@/services/auth";
import {
  deleteAuthenticatedAccount,
  fetchAuthenticatedAccount,
  type AuthenticatedAccount,
} from "@/services/account";
import { fetchProfile, updateProfile } from "@/services/profile";
import {
  fetchReferralProgram,
  type ReferralProgramData,
} from "@/services/referrals";
import {
  fetchSubscriptionStatus,
  runSubscriptionOperation,
} from "@/services/subscriptions";

type ProfileField =
  | "fullName"
  | "email"
  | "phone"
  | "companyName"
  | "billingName"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "stateRegion"
  | "postalCode"
  | "country";

type ProfileFormState = Record<ProfileField, string>;
type ProfilePatch = Partial<
  Omit<UserAutofillProfile, "userId" | "createdAt" | "updatedAt">
>;

const PROFILE_FIELDS: ProfileField[] = [
  "fullName",
  "email",
  "phone",
  "companyName",
  "billingName",
  "addressLine1",
  "addressLine2",
  "city",
  "stateRegion",
  "postalCode",
  "country",
];

function emptyProfileForm(): ProfileFormState {
  return {
    fullName: "",
    email: "",
    phone: "",
    companyName: "",
    billingName: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateRegion: "",
    postalCode: "",
    country: "",
  };
}

function profileToForm(
  profile: UserAutofillProfile | null,
  fallbackEmail: string,
): ProfileFormState {
  return {
    fullName: profile?.fullName || "",
    email: profile?.email || fallbackEmail,
    phone: profile?.phone || "",
    companyName: profile?.companyName || "",
    billingName: profile?.billingName || "",
    addressLine1: profile?.addressLine1 || "",
    addressLine2: profile?.addressLine2 || "",
    city: profile?.city || "",
    stateRegion: profile?.stateRegion || "",
    postalCode: profile?.postalCode || "",
    country: profile?.country || "",
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function statusClass(status: SubscriptionActionRecord["status"]): string {
  if (status === "completed") return "text-[var(--aw-success)]";
  if (status === "failed") return "text-[var(--aw-danger)]";
  if (status === "blocked") return "text-[var(--aw-warning)]";
  return "text-[var(--aw-text-soft)]";
}

function SettingsModal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4"
      onClick={onClose}
    >
      <div
        className="aw-surface-elevated w-full max-w-lg p-5 md:p-6 animate-sheet-rise"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[var(--aw-text)]">{title}</h3>
            <p className="mt-1 text-sm text-[var(--aw-text-soft)]">{description}</p>
          </div>
          <button
            type="button"
            className="aw-button-secondary h-8 px-3 text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function ProfileFieldInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel";
  placeholder?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-[var(--aw-text-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="aw-input h-10 text-sm"
      />
    </label>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<AuthenticatedAccount | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const [profileForm, setProfileForm] = useState<ProfileFormState>(
    emptyProfileForm,
  );
  const [savedProfileForm, setSavedProfileForm] = useState<ProfileFormState>(
    emptyProfileForm,
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const [subscriptions, setSubscriptions] = useState<ActiveSubscriptionTask[]>(
    [],
  );
  const [subscriptionActions, setSubscriptionActions] = useState<
    SubscriptionActionRecord[]
  >([]);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ActiveSubscriptionTask | null>(
    null,
  );
  const [cancelingTaskId, setCancelingTaskId] = useState<string | null>(null);

  const [referral, setReferral] = useState<ReferralProgramData | null>(null);
  const [referralLoading, setReferralLoading] = useState(true);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralNotice, setReferralNotice] = useState<string | null>(null);

  const [resetLoading, setResetLoading] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const [signingOut, setSigningOut] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const profileDirty = useMemo(
    () =>
      PROFILE_FIELDS.some((field) => profileForm[field] !== savedProfileForm[field]),
    [profileForm, savedProfileForm],
  );

  const latestCancelByTask = useMemo(() => {
    const map = new Map<string, SubscriptionActionRecord>();
    for (const action of subscriptionActions) {
      if (action.operation !== "cancel") continue;
      const prev = map.get(action.taskId);
      if (!prev || Date.parse(action.createdAt) > Date.parse(prev.createdAt)) {
        map.set(action.taskId, action);
      }
    }
    return map;
  }, [subscriptionActions]);

  const loadIdentityAndProfile = useCallback(async () => {
    try {
      const [accountResult, profileResult] = await Promise.all([
        fetchAuthenticatedAccount(),
        fetchProfile(),
      ]);
      setAccount(accountResult);
      const form = profileToForm(profileResult, accountResult.email);
      setProfileForm(form);
      setSavedProfileForm(form);
      setAccountError(null);
    } catch (error) {
      setAccountError(
        toErrorMessage(error, "Failed to load account and profile settings."),
      );
    }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    setSubscriptionLoading(true);
    try {
      const result = await fetchSubscriptionStatus();
      setSubscriptions(result.activeSubscriptions);
      setSubscriptionActions(result.actions);
      setSubscriptionError(null);
    } catch (error) {
      setSubscriptionError(
        toErrorMessage(error, "Failed to load subscription management."),
      );
    } finally {
      setSubscriptionLoading(false);
    }
  }, []);

  const loadReferral = useCallback(async () => {
    setReferralLoading(true);
    try {
      const referralResult = await fetchReferralProgram();
      setReferral(referralResult);
      setReferralError(null);
    } catch (error) {
      setReferralError(
        toErrorMessage(error, "Failed to load referral program."),
      );
    } finally {
      setReferralLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setIsBootstrapping(true);
    await Promise.all([
      loadIdentityAndProfile(),
      loadSubscriptions(),
      loadReferral(),
    ]);
    setIsBootstrapping(false);
  }, [loadIdentityAndProfile, loadReferral, loadSubscriptions]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const updateProfileField = useCallback(
    (field: ProfileField, value: string) => {
      setProfileForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    [],
  );

  const saveProfile = useCallback(async () => {
    setProfileError(null);
    setProfileNotice(null);

    const patch: ProfilePatch = {};
    for (const field of PROFILE_FIELDS) {
      const value = profileForm[field].trim();
      if (value) {
        patch[field] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      setProfileError("Add at least one profile field before saving.");
      return;
    }

    setProfileSaving(true);
    try {
      const updated = await updateProfile(patch);
      const form = profileToForm(updated, account?.email || "");
      setProfileForm(form);
      setSavedProfileForm(form);
      setProfileNotice("Profile saved.");
    } catch (error) {
      setProfileError(toErrorMessage(error, "Failed to save profile."));
    } finally {
      setProfileSaving(false);
    }
  }, [account?.email, profileForm]);

  const sendResetLink = useCallback(async () => {
    if (!account?.email) {
      setResetError("Could not resolve your account email.");
      return;
    }

    setResetError(null);
    setResetNotice(null);
    setResetLoading(true);
    try {
      const result = await requestPasswordReset({ email: account.email });
      setResetNotice(result.message);
    } catch (error) {
      setResetError(toErrorMessage(error, "Failed to send reset link."));
    } finally {
      setResetLoading(false);
    }
  }, [account?.email]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  const requestCancelSubscription = useCallback(
    (task: ActiveSubscriptionTask) => {
      setSubscriptionError(null);
      setSubscriptionNotice(null);
      setCancelTarget(task);
    },
    [],
  );

  const confirmCancelSubscription = useCallback(async () => {
    if (!cancelTarget) return;

    setSubscriptionError(null);
    setSubscriptionNotice(null);
    setCancelingTaskId(cancelTarget.taskId);

    try {
      await runSubscriptionOperation({
        taskId: cancelTarget.taskId,
        operation: "cancel",
      });
      setSubscriptionNotice(
        `Cancellation flow started for ${cancelTarget.vendorName}.`,
      );
      setCancelTarget(null);
      await loadSubscriptions();
    } catch (error) {
      setSubscriptionError(
        toErrorMessage(error, "Failed to start cancellation flow."),
      );
    } finally {
      setCancelingTaskId(null);
    }
  }, [cancelTarget, loadSubscriptions]);

  const copyReferralLink = useCallback(async () => {
    if (!referral) return;
    setReferralNotice(null);
    try {
      await copyToClipboard(referral.shareUrl);
      setReferralNotice("Referral link copied.");
    } catch (error) {
      setReferralError(toErrorMessage(error, "Could not copy referral link."));
    }
  }, [referral]);

  const copyReferralMessage = useCallback(async () => {
    if (!referral) return;
    setReferralNotice(null);
    try {
      await copyToClipboard(referral.inviteMessage);
      setReferralNotice("Referral message copied.");
    } catch (error) {
      setReferralError(
        toErrorMessage(error, "Could not copy referral message."),
      );
    }
  }, [referral]);

  const confirmDeleteAccount = useCallback(async () => {
    setDeleteError(null);
    setDeleteLoading(true);

    try {
      await deleteAuthenticatedAccount({
        password: deletePassword,
        confirmText: deleteConfirmText,
      });
      router.replace("/login?accountDeleted=1");
      router.refresh();
    } catch (error) {
      setDeleteError(toErrorMessage(error, "Failed to delete account."));
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteConfirmText, deletePassword, router]);

  const canSubmitDelete =
    deletePassword.trim().length > 0
    && deleteConfirmText.trim().toUpperCase() === "DELETE"
    && !deleteLoading;

  return (
    <div className="aw-page">
      <div className="aw-page-header flex items-start justify-between gap-3">
        <div>
          <p className="aw-page-kicker">Settings</p>
          <h1 className="aw-page-title">Account Settings</h1>
          <p className="aw-page-subtitle">
            Profile, agent rules, subscription controls, referrals, and account safety.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refreshAll();
          }}
          className="aw-button-secondary h-9 px-3 text-xs"
          disabled={isBootstrapping}
        >
          <span className="inline-flex items-center gap-1">
            {isBootstrapping ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Refresh
          </span>
        </button>
      </div>

      {accountError && (
        <p className="mb-4 rounded-xl border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
          {accountError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="space-y-5">
          <article className="aw-surface p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="aw-kicker">Profile</p>
                <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Profile & Billing Autofill
                </h2>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  Keep contact and billing details current so agent actions stay accurate.
                </p>
              </div>
              {account?.email && (
                <p className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-2.5 py-1 text-[11px] text-[var(--aw-text-soft)]">
                  Sign-in: {account.email}
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <ProfileFieldInput
                label="Full name"
                value={profileForm.fullName}
                onChange={(value) => updateProfileField("fullName", value)}
                placeholder="Alex Johnson"
              />
              <ProfileFieldInput
                label="Profile email"
                type="email"
                value={profileForm.email}
                onChange={(value) => updateProfileField("email", value)}
                placeholder="alex@example.com"
              />
              <ProfileFieldInput
                label="Phone"
                type="tel"
                value={profileForm.phone}
                onChange={(value) => updateProfileField("phone", value)}
                placeholder="(555) 555-0199"
              />
              <ProfileFieldInput
                label="Company"
                value={profileForm.companyName}
                onChange={(value) => updateProfileField("companyName", value)}
                placeholder="Acme Inc"
              />
              <ProfileFieldInput
                label="Billing name"
                value={profileForm.billingName}
                onChange={(value) => updateProfileField("billingName", value)}
              />
              <ProfileFieldInput
                label="Address line 1"
                value={profileForm.addressLine1}
                onChange={(value) => updateProfileField("addressLine1", value)}
              />
              <ProfileFieldInput
                label="Address line 2"
                value={profileForm.addressLine2}
                onChange={(value) => updateProfileField("addressLine2", value)}
              />
              <ProfileFieldInput
                label="City"
                value={profileForm.city}
                onChange={(value) => updateProfileField("city", value)}
              />
              <ProfileFieldInput
                label="State/region"
                value={profileForm.stateRegion}
                onChange={(value) => updateProfileField("stateRegion", value)}
              />
              <ProfileFieldInput
                label="Postal code"
                value={profileForm.postalCode}
                onChange={(value) => updateProfileField("postalCode", value)}
              />
              <div className="md:col-span-2">
                <ProfileFieldInput
                  label="Country"
                  value={profileForm.country}
                  onChange={(value) => updateProfileField("country", value)}
                  placeholder="United States"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void saveProfile();
                }}
                className="aw-button-primary h-10 px-4 text-sm"
                disabled={profileSaving || !profileDirty}
              >
                {profileSaving ? "Saving..." : "Save Profile"}
              </button>
              <button
                type="button"
                onClick={() => setProfileForm({ ...savedProfileForm })}
                className="aw-button-secondary h-10 px-4 text-sm"
                disabled={!profileDirty || profileSaving}
              >
                Reset Unsaved
              </button>
              {account?.expiresAt && (
                <p className="text-[11px] text-[var(--aw-text-muted)]">
                  Session valid until {fmtFull(account.expiresAt)}
                </p>
              )}
            </div>

            {profileNotice && (
              <p className="mt-3 rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
                {profileNotice}
              </p>
            )}
            {profileError && (
              <p className="mt-3 rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
                {profileError}
              </p>
            )}
          </article>

          <SettingsPanel alwaysShow />
        </section>

        <section className="space-y-5">
          <article className="aw-surface p-4 md:p-5">
            <p className="aw-kicker">Account</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
              Account Controls
            </h2>
            <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
              Security actions connected to your real account flows.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => {
                  void sendResetLink();
                }}
                className="aw-button-secondary h-10 px-3 text-sm"
                disabled={resetLoading || !account?.email}
              >
                {resetLoading ? "Sending reset link..." : "Send Password Reset Link"}
              </button>

              <button
                type="button"
                onClick={() => {
                  void signOut();
                }}
                className="aw-button-secondary h-10 px-3 text-sm"
                disabled={signingOut}
              >
                {signingOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>

            {resetNotice && (
              <p className="mt-3 rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
                {resetNotice}
              </p>
            )}
            {resetError && (
              <p className="mt-3 rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
                {resetError}
              </p>
            )}
          </article>

          <article className="aw-surface p-4 md:p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="aw-kicker">Subscriptions</p>
                <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Cancel Subscription
                </h2>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  Start cancellation operations for active subscription tasks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadSubscriptions();
                }}
                className="aw-button-secondary h-8 px-3 text-xs"
                disabled={subscriptionLoading}
              >
                Refresh
              </button>
            </div>

            {subscriptionLoading ? (
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--aw-text-muted)]">
                <Loader2 size={12} className="animate-spin" />
                Loading subscriptions...
              </p>
            ) : subscriptions.length === 0 ? (
              <div className="aw-empty-state mt-3 space-y-2 px-3 py-3">
                <p className="text-sm">No active subscriptions available to cancel.</p>
                <Link href="/subscriptions" className="aw-button-secondary inline-flex h-8 items-center px-3 text-xs">
                  Open Subscriptions Workspace
                </Link>
              </div>
            ) : (
              <div className="aw-scroll mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {subscriptions.map((subscription) => {
                  const latestCancel = latestCancelByTask.get(subscription.taskId);
                  const isRunning =
                    cancelingTaskId === subscription.taskId
                    || latestCancel?.status === "running";

                  return (
                    <article
                      key={subscription.taskId}
                      className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[var(--aw-text)]">
                            {subscription.vendorName}
                          </p>
                          <p className="text-[11px] text-[var(--aw-text-soft)]">
                            {subscription.planName}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => requestCancelSubscription(subscription)}
                          className="aw-button-secondary h-8 px-3 text-xs"
                          disabled={isRunning}
                        >
                          {isRunning ? "Canceling..." : "Cancel"}
                        </button>
                      </div>

                      {latestCancel && (
                        <p className={`mt-1 text-[11px] ${statusClass(latestCancel.status)}`}>
                          Latest cancel status: {latestCancel.status}
                          {latestCancel.updatedAt
                            ? ` · ${fmtFull(latestCancel.updatedAt)}`
                            : ""}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {subscriptionNotice && (
              <p className="mt-3 rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
                {subscriptionNotice}
              </p>
            )}
            {subscriptionError && (
              <p className="mt-3 rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
                {subscriptionError}
              </p>
            )}
          </article>

          <article className="aw-surface p-4 md:p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="aw-kicker">Growth</p>
                <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Referral Program
                </h2>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  Invite users with your referral code and shareable launch link.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadReferral();
                }}
                className="aw-button-secondary h-8 px-3 text-xs"
                disabled={referralLoading}
              >
                Refresh
              </button>
            </div>

            {referralLoading ? (
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--aw-text-muted)]">
                <Loader2 size={12} className="animate-spin" />
                Loading referral details...
              </p>
            ) : referral ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                    Referral code
                  </p>
                  <p className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                    {referral.code}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--aw-text-soft)]">
                    {referral.rewardText}
                  </p>
                </div>

                <a
                  href={referral.shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-[var(--aw-primary-strong)] hover:underline"
                >
                  {referral.shareUrl}
                </a>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => {
                      void copyReferralLink();
                    }}
                    className="aw-button-secondary h-9 px-3 text-xs"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Copy size={12} />
                      Copy Link
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void copyReferralMessage();
                    }}
                    className="aw-button-secondary h-9 px-3 text-xs"
                  >
                    Copy Message
                  </button>
                  <a
                    href={referral.shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="aw-button-secondary inline-flex h-9 items-center justify-center px-3 text-xs"
                  >
                    Open Invite Link
                  </a>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--aw-text-muted)]">
                Referral details are not available right now.
              </p>
            )}

            {referralNotice && (
              <p className="mt-3 rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
                {referralNotice}
              </p>
            )}
            {referralError && (
              <p className="mt-3 rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
                {referralError}
              </p>
            )}
          </article>

          <article className="aw-surface p-4 md:p-5">
            <div className="flex items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5 text-[var(--aw-danger)]" />
              <div>
                <p className="aw-kicker">Danger Zone</p>
                <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Delete Account
                </h2>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  Permanently delete your account and associated workspace data.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setDeletePassword("");
                setDeleteConfirmText("");
                setDeleteModalOpen(true);
              }}
              className="aw-button-secondary mt-4 inline-flex h-10 items-center gap-1 border-[var(--aw-danger)]/30 text-[var(--aw-danger)] hover:border-[var(--aw-danger)]"
            >
              <Trash2 size={13} />
              Delete Account
            </button>
          </article>
        </section>
      </div>

      <SettingsModal
        open={Boolean(cancelTarget)}
        title="Confirm Cancellation"
        description="This starts a real cancellation operation for the selected subscription."
        onClose={() => {
          if (cancelingTaskId) return;
          setCancelTarget(null);
        }}
      >
        {cancelTarget && (
          <div className="space-y-3">
            <div className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
              <p className="text-sm font-semibold text-[var(--aw-text)]">
                {cancelTarget.vendorName}
              </p>
              <p className="text-xs text-[var(--aw-text-soft)]">
                {cancelTarget.planName}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="aw-button-primary h-9 px-3 text-sm"
                onClick={() => {
                  void confirmCancelSubscription();
                }}
                disabled={Boolean(cancelingTaskId)}
              >
                {cancelingTaskId ? "Starting..." : "Start Cancellation"}
              </button>
              <button
                type="button"
                className="aw-button-secondary h-9 px-3 text-sm"
                onClick={() => setCancelTarget(null)}
                disabled={Boolean(cancelingTaskId)}
              >
                Keep Subscription
              </button>
            </div>
          </div>
        )}
      </SettingsModal>

      <SettingsModal
        open={deleteModalOpen}
        title="Delete Account"
        description="This action is permanent. Type DELETE and enter your password to continue."
        onClose={() => {
          if (deleteLoading) return;
          setDeleteModalOpen(false);
        }}
      >
        <div className="space-y-3">
          <p className="rounded-lg border border-[var(--aw-warning)]/30 bg-[var(--aw-warning)]/10 px-3 py-2 text-xs text-[var(--aw-text-soft)]">
            This removes access to your Agent Wallet account and signs out this session immediately.
          </p>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Current password</span>
            <input
              type="password"
              className="aw-input h-10 text-sm"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">
              Type <span className="font-semibold">DELETE</span> to confirm
            </span>
            <input
              type="text"
              className="aw-input h-10 text-sm"
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
              placeholder="DELETE"
            />
          </label>

          {deleteError && (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {deleteError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="aw-button-primary h-9 px-3 text-sm"
              disabled={!canSubmitDelete}
              onClick={() => {
                void confirmDeleteAccount();
              }}
            >
              {deleteLoading ? "Deleting..." : "Delete My Account"}
            </button>
            <button
              type="button"
              className="aw-button-secondary h-9 px-3 text-sm"
              disabled={deleteLoading}
              onClick={() => setDeleteModalOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </SettingsModal>
    </div>
  );
}
