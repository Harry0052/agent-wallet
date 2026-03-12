"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Loader2 } from "lucide-react";
import { SettingsModal } from "@/components/settings/SettingsModal";
import {
  fetchReferralProgram,
  type ReferralProgramData,
} from "@/services/referrals";

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

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

interface ConnectedToolsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectedToolsModal({ open, onClose }: ConnectedToolsModalProps) {
  const [referral, setReferral] = useState<ReferralProgramData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadReferral = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const referralResult = await fetchReferralProgram();
      setReferral(referralResult);
    } catch (loadError) {
      setError(toErrorMessage(loadError, "Failed to load referral program."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadReferral();
  }, [loadReferral, open]);

  const copyReferralLink = async () => {
    if (!referral) return;
    setNotice(null);
    try {
      await copyToClipboard(referral.shareUrl);
      setNotice("Referral link copied.");
    } catch (copyError) {
      setError(toErrorMessage(copyError, "Could not copy referral link."));
    }
  };

  const copyReferralMessage = async () => {
    if (!referral) return;
    setNotice(null);
    try {
      await copyToClipboard(referral.inviteMessage);
      setNotice("Referral message copied.");
    } catch (copyError) {
      setError(toErrorMessage(copyError, "Could not copy referral message."));
    }
  };

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="Connected Tools"
      description="Manage linked tools and share referral assets."
      maxWidthClassName="max-w-3xl"
    >
      <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
        <p className="text-xs text-[var(--aw-text-soft)]">
          Open the tools workspace to connect, reconnect, or remove integrations.
        </p>
        <Link
          href="/tools"
          className="aw-button-primary mt-3 inline-flex h-10 items-center px-3 text-sm"
        >
          Open Connected Tools
        </Link>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--aw-text)]">Referral Program</p>
            <p className="text-xs text-[var(--aw-text-soft)]">
              Copy your invite assets and launch link.
            </p>
          </div>
          <button
            type="button"
            className="aw-button-secondary h-8 px-3 text-xs"
            onClick={() => {
              void loadReferral();
            }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--aw-text-muted)]">
            <Loader2 size={12} className="animate-spin" />
            Loading referral details...
          </p>
        ) : referral ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-1)] px-3 py-2">
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
    </SettingsModal>
  );
}
