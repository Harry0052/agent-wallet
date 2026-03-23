"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { SettingsModal } from "@/components/settings/SettingsModal";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "feature_request", label: "Feature request" },
  { value: "bug", label: "Something's off" },
  { value: "praise", label: "Something I like" },
] as const;

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    // Reset state after close animation
    setTimeout(() => {
      setMessage("");
      setCategory("general");
      setSubmitted(false);
      setError(null);
    }, 200);
    onClose();
  };

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, category, route: pathname }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send feedback.");
      }

      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsModal
      open={open}
      title="Share your feedback"
      onClose={handleClose}
      maxWidthClassName="max-w-md"
    >
      {submitted ? (
        <div className="py-6 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: "rgba(22, 163, 74, 0.08)" }}
          >
            <CheckCircle2 size={24} className="text-[#16A34A]" />
          </div>
          <p className="text-[1rem] font-semibold text-[var(--aw-text)]">
            Thank you for your feedback
          </p>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[var(--aw-text-muted)]">
            We read every response. Your input directly shapes what we build next.
          </p>
          <button
            type="button"
            onClick={handleClose}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-xl px-6 text-sm font-semibold transition-colors"
            style={{
              background: "var(--calico-primary, #FDBA74)",
              color: "var(--aw-text, #111)",
            }}
          >
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-[var(--aw-text-muted)]">
            Tell us what's working, what isn't, or what you'd like to see.
            Honest feedback helps us build a better product for you.
          </p>

          {/* Category selector */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className="rounded-full border px-3.5 py-1.5 text-[0.78rem] font-medium transition-all"
                style={{
                  borderColor: category === cat.value
                    ? "var(--calico-primary, #FDBA74)"
                    : "var(--aw-border)",
                  background: category === cat.value
                    ? "rgba(253, 186, 116, 0.1)"
                    : "transparent",
                  color: category === cat.value
                    ? "var(--aw-text)"
                    : "var(--aw-text-muted)",
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Message input */}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What's on your mind?"
            rows={4}
            maxLength={2000}
            disabled={submitting}
            className="w-full resize-none rounded-xl border bg-white px-4 py-3 text-[0.88rem] leading-relaxed text-[var(--aw-text)] outline-none transition-shadow placeholder:text-[var(--aw-text-muted)]/40 focus:shadow-[0_0_0_2px_rgba(253,186,116,0.2)] disabled:opacity-50"
            style={{ borderColor: "var(--aw-border)" }}
          />

          {/* Character count */}
          <div className="flex items-center justify-between">
            <p className="text-[0.72rem] text-[var(--aw-text-muted)]">
              {message.length}/2000
            </p>
          </div>

          {/* Incentive note */}
          <div
            className="rounded-xl px-3.5 py-2.5"
            style={{ background: "rgba(253, 186, 116, 0.06)" }}
          >
            <p className="text-[0.75rem] leading-relaxed text-[var(--aw-text-muted)]">
              Eligible users who provide thoughtful product feedback may receive a complimentary plan upgrade for the following month.
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-[0.82rem] text-[#DC2626]">{error}</p>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => { void handleSubmit(); }}
              disabled={!message.trim() || submitting}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{
                background: "var(--calico-primary, #FDBA74)",
                color: "var(--aw-text, #111)",
              }}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Sending...
                </>
              ) : (
                "Send feedback"
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--aw-border)] bg-white px-5 text-sm font-semibold text-[var(--aw-text-muted)] transition-colors hover:bg-[var(--aw-surface-subtle)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </SettingsModal>
  );
}
