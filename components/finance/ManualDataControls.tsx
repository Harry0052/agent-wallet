"use client";

import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { cn } from "@/lib/utils";

export type DataSourceMode = "connected" | "manual";

export function DataSourceToggle(props: {
  mode: DataSourceMode;
  onChange: (mode: DataSourceMode) => void;
  className?: string;
  connectedLabel?: string;
  manualLabel?: string;
}) {
  const {
    mode,
    onChange,
    className,
    connectedLabel = "Connected",
    manualLabel = "Manual",
  } = props;

  return (
    <div className={cn("aw-segmented", className)}>
      <button
        type="button"
        data-active={mode === "connected"}
        onClick={() => onChange("connected")}
      >
        {connectedLabel}
      </button>
      <button
        type="button"
        data-active={mode === "manual"}
        onClick={() => onChange("manual")}
      >
        {manualLabel}
      </button>
    </div>
  );
}

export function ManualEntryButton(props: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "aw-button-secondary inline-flex h-[38px] items-center gap-1.5 rounded-xl px-4 text-sm",
        props.className,
      )}
    >
      <Plus size={14} />
      {props.children}
    </button>
  );
}

export function ManualEntryModal(props: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}) {
  return (
    <SettingsModal
      open={props.open}
      title={props.title}
      description={props.description}
      onClose={props.onClose}
      maxWidthClassName={props.maxWidthClassName ?? "max-w-lg"}
    >
      {props.children}
    </SettingsModal>
  );
}
