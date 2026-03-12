"use client";

import type { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <article className="aw-surface p-4 md:p-5">
      <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
        {title}
      </h3>
      <div className="mt-3 space-y-2">{children}</div>
    </article>
  );
}
