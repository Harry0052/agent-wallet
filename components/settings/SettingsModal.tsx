"use client";

import { useEffect, type ReactNode } from "react";

interface SettingsModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}

export function SettingsModal({
  open,
  title,
  description,
  onClose,
  children,
  maxWidthClassName = "max-w-2xl",
}: SettingsModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={`aw-surface-elevated w-full ${maxWidthClassName} animate-sheet-rise p-5 md:p-6`}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--aw-text)]">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-[var(--aw-text-soft)]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="aw-button-secondary h-8 px-3 text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}
