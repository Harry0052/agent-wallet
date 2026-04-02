"use client";

import { useState, useRef } from "react";
import { ArrowUp } from "lucide-react";
import { InlineSpinner } from "@/components/skeleton";

interface CommandInputProps {
  onSubmit: (input: string) => void;
  loading?: boolean;
  placeholder?: string;
}

export function CommandInput({ onSubmit, loading, placeholder }: CommandInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className="flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 transition-shadow focus-within:shadow-[0_0_0_2px_rgba(59,130,246,0.15)]"
      style={{ borderColor: "var(--aw-border)" }}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Tell Calico what to do..."}
        disabled={loading}
        className="min-w-0 flex-1 bg-transparent text-[0.9rem] text-[var(--aw-text)] outline-none placeholder:text-[var(--aw-text-muted)]/50"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!value.trim() || loading}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-all disabled:opacity-30"
        style={{
          background: value.trim() ? "var(--aw-text)" : "var(--aw-surface-subtle)",
          color: value.trim() ? "#fff" : "var(--aw-text-muted)",
        }}
      >
        {loading ? (
          <InlineSpinner size={16} />
        ) : (
          <ArrowUp size={16} />
        )}
      </button>
    </div>
  );
}
