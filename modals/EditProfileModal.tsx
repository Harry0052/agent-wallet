"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { fetchProfile, updateProfile } from "@/services/profile";
import type { UserAutofillProfile } from "@/lib/types";

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

type ProfilePatch = Partial<
  Omit<UserAutofillProfile, "userId" | "createdAt" | "updatedAt">
>;

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

interface EditProfileModalProps {
  open: boolean;
  accountEmail: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditProfileModal({
  open,
  accountEmail,
  onClose,
  onSaved,
}: EditProfileModalProps) {
  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm);
  const [savedProfileForm, setSavedProfileForm] = useState<ProfileFormState>(
    emptyProfileForm,
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const profileDirty = useMemo(
    () =>
      PROFILE_FIELDS.some((field) => profileForm[field] !== savedProfileForm[field]),
    [profileForm, savedProfileForm],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await fetchProfile();
      const form = profileToForm(profile, accountEmail);
      setProfileForm(form);
      setSavedProfileForm(form);
    } catch (loadError) {
      setError(toErrorMessage(loadError, "Failed to load profile settings."));
    } finally {
      setLoading(false);
    }
  }, [accountEmail]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const updateProfileField = (field: ProfileField, value: string) => {
    setProfileForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const saveProfile = async () => {
    setError(null);
    setNotice(null);

    const patch: ProfilePatch = {};
    for (const field of PROFILE_FIELDS) {
      const value = profileForm[field].trim();
      if (value) {
        patch[field] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      setError("Add at least one profile field before saving.");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile(patch);
      const form = profileToForm(updated, accountEmail);
      setProfileForm(form);
      setSavedProfileForm(form);
      setNotice("Profile saved.");
      onSaved();
      onClose();
    } catch (saveError) {
      setError(toErrorMessage(saveError, "Failed to save profile."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="Edit Profile"
      description="Update profile and billing autofill values used by autonomous actions."
      maxWidthClassName="max-w-3xl"
    >
      {loading ? (
        <p className="text-sm text-[var(--aw-text-muted)]">Loading profile...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="aw-button-primary h-10 px-4 text-sm"
              onClick={() => {
                void saveProfile();
              }}
              disabled={!profileDirty || saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="aw-button-secondary h-10 px-4 text-sm"
              onClick={() => setProfileForm({ ...savedProfileForm })}
              disabled={!profileDirty || saving}
            >
              Cancel Changes
            </button>
          </div>
          {notice ? (
            <p className="mt-3 rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {error}
            </p>
          ) : null}
        </>
      )}
    </SettingsModal>
  );
}
