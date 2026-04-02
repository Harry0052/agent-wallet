"use client";

import { useState, useRef, useEffect } from "react";
import { AlertTriangle, Eye, EyeOff, Lock, Shield, X } from "lucide-react";
import { InlineSpinner } from "@/components/skeleton";

export interface CredentialRequestDisplay {
  id: string;
  taskId: string;
  service: string;
  inputType: "email" | "password" | "otp" | "2fa_code" | "security_answer" | "pin" | "username" | "phone";
  prompt: string;
  hint?: string;
  expiresAt: string;
}

interface CredentialModalProps {
  request: CredentialRequestDisplay;
  onSubmit: (requestId: string, value: string) => Promise<void>;
  onCancel: (requestId: string) => void;
  submitting?: boolean;
  error?: string | null;
}

const INPUT_CONFIG: Record<string, {
  label: string;
  placeholder: string;
  type: string;
  autoComplete: string;
  maxLength: number;
}> = {
  email: { label: "Email", placeholder: "you@example.com", type: "email", autoComplete: "email", maxLength: 200 },
  username: { label: "Username", placeholder: "Your username", type: "text", autoComplete: "username", maxLength: 200 },
  password: { label: "Password", placeholder: "Your password", type: "password", autoComplete: "current-password", maxLength: 500 },
  otp: { label: "Verification code", placeholder: "123456", type: "text", autoComplete: "one-time-code", maxLength: 10 },
  "2fa_code": { label: "Two-factor code", placeholder: "123456", type: "text", autoComplete: "one-time-code", maxLength: 10 },
  security_answer: { label: "Security answer", placeholder: "Your answer", type: "text", autoComplete: "off", maxLength: 200 },
  pin: { label: "PIN", placeholder: "1234", type: "password", autoComplete: "off", maxLength: 12 },
  phone: { label: "Phone number", placeholder: "(555) 123-4567", type: "tel", autoComplete: "tel", maxLength: 20 },
};

const TRUST_COPY: Record<string, string> = {
  password: "Your password is encrypted immediately and deleted after use. Calico never stores passwords.",
  otp: "This code will be used once and immediately discarded.",
  "2fa_code": "This code will be used once and immediately discarded.",
  pin: "Your PIN is encrypted and deleted immediately after use.",
  email: "Used only to identify your account on this service.",
  username: "Used only to identify your account on this service.",
  security_answer: "Encrypted and deleted immediately after use.",
  phone: "Used only for account verification.",
};

export function CredentialModal({
  request,
  onSubmit,
  onCancel,
  submitting = false,
  error,
}: CredentialModalProps) {
  const [value, setValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const config = INPUT_CONFIG[request.inputType] ?? INPUT_CONFIG.password;
  const isSecret = request.inputType === "password" || request.inputType === "pin";
  const isCode = request.inputType === "otp" || request.inputType === "2fa_code";

  // Countdown timer
  const [timeLeft, setTimeLeft] = useState<string>("");
  useEffect(() => {
    const update = () => {
      const ms = Date.parse(request.expiresAt) - Date.now();
      if (ms <= 0) {
        setTimeLeft("Expired");
        return;
      }
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      setTimeLeft(`${mins}:${secs.toString().padStart(2, "0")}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [request.expiresAt]);

  // Auto-focus input
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = () => {
    if (!value.trim() || submitting) return;
    void onSubmit(request.id, value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const expired = timeLeft === "Expired";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => onCancel(request.id)}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-2xl border bg-white shadow-xl"
        style={{ borderColor: "var(--aw-border)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: "rgba(59, 130, 246, 0.08)" }}
            >
              {isCode ? (
                <Shield size={20} className="text-[#3B82F6]" />
              ) : (
                <Lock size={20} className="text-[#3B82F6]" />
              )}
            </div>
            <div>
              <h2 className="text-[1rem] font-semibold text-[var(--aw-text)]">
                {isCode ? "Verification needed" : "Login needed"}
              </h2>
              <p className="text-[0.78rem] text-[var(--aw-text-muted)]">
                {request.service}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onCancel(request.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--aw-text-muted)] transition-colors hover:bg-[var(--aw-surface-subtle)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-6">
          {/* Prompt */}
          <p className="text-[0.85rem] leading-relaxed text-[var(--aw-text)]">
            {request.prompt}
          </p>

          {/* Input */}
          <div className="relative mt-4">
            <label className="mb-1.5 block text-[0.78rem] font-semibold text-[var(--aw-text-muted)]">
              {config.label}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type={isSecret && !showPassword ? "password" : config.type}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={config.placeholder}
                autoComplete={config.autoComplete}
                maxLength={config.maxLength}
                disabled={submitting || expired}
                className="w-full rounded-xl border bg-white px-4 py-3 pr-12 text-[0.88rem] text-[var(--aw-text)] outline-none transition-shadow placeholder:text-[var(--aw-text-muted)]/40 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.15)] disabled:opacity-50"
                style={{ borderColor: error ? "rgba(220, 38, 38, 0.3)" : "var(--aw-border)" }}
              />
              {isSecret && (
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--aw-text-muted)] hover:text-[var(--aw-text)]"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              )}
            </div>
            {request.hint && (
              <p className="mt-1.5 text-[0.72rem] text-[var(--aw-text-muted)]">
                {request.hint}
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div
              className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5"
              style={{
                background: "rgba(220, 38, 38, 0.05)",
                border: "1px solid rgba(220, 38, 38, 0.12)",
              }}
            >
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-[#DC2626]" />
              <p className="text-[0.78rem] text-[#DC2626]/80">{error}</p>
            </div>
          )}

          {/* Trust copy */}
          <div
            className="mt-4 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
            style={{ background: "var(--aw-surface-subtle)" }}
          >
            <Shield size={13} className="mt-0.5 flex-shrink-0 text-[#3B82F6]" />
            <p className="text-[0.72rem] leading-relaxed text-[var(--aw-text-muted)]">
              {TRUST_COPY[request.inputType] ?? "This information is encrypted and used only for this task."}
            </p>
          </div>

          {/* Timer */}
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[0.72rem] text-[var(--aw-text-muted)]">
              {expired ? (
                <span className="text-[#DC2626]">This request has expired. Please try again.</span>
              ) : (
                <>Expires in {timeLeft}</>
              )}
            </p>
          </div>

          {/* Actions */}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!value.trim() || submitting || expired}
              className="flex-1 rounded-xl py-3 text-[0.85rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "var(--aw-text)" }}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <InlineSpinner size={15} />
                  Sending securely...
                </span>
              ) : (
                "Continue"
              )}
            </button>
            <button
              type="button"
              onClick={() => onCancel(request.id)}
              disabled={submitting}
              className="rounded-xl border border-[var(--aw-border)] bg-white px-5 py-3 text-[0.85rem] font-semibold text-[var(--aw-text-muted)] transition-colors hover:bg-[var(--aw-surface-subtle)]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
