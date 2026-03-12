"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

interface SettingsButtonProps {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

export function SettingsButton({ label, onClick, icon: Icon }: SettingsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="aw-button-secondary flex h-11 w-full items-center justify-between px-3 text-sm"
    >
      <span className="inline-flex items-center gap-2 text-[var(--aw-text)]">
        {Icon ? <Icon size={15} className="text-[var(--aw-text-soft)]" /> : null}
        {label}
      </span>
      <ChevronRight size={14} className="text-[var(--aw-text-muted)]" />
    </button>
  );
}
