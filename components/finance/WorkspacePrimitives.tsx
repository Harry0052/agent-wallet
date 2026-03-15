import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WorkspaceTabItem {
  label: string;
  active?: boolean;
}

export function WorkspaceHeader(props: {
  title: string;
  subtitle?: string;
  tabs?: WorkspaceTabItem[];
  actions?: ReactNode;
}) {
  const { title, subtitle, tabs, actions } = props;
  return (
    <div className="aw-workspace-header">
      <div className="min-w-0">
        {tabs && tabs.length > 0 ? (
          <div className="aw-workspace-tabs mb-3 gap-4">
            {tabs.map((tab) => (
              <button key={tab.label} type="button" className="aw-workspace-tab" data-active={tab.active}>
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
        <h1 className="aw-workspace-title">{title}</h1>
        {subtitle ? <p className="aw-workspace-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="aw-toolbar">{actions}</div> : null}
    </div>
  );
}

export function ToolbarButton(props: {
  children?: ReactNode;
  icon?: ReactNode;
  variant?: "default" | "primary";
  active?: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const { children, icon, variant = "default", active, href, onClick, disabled } = props;
  const className = cn("aw-toolbar-btn", active ? "bg-[var(--aw-surface-subtle)]" : "", disabled ? "opacity-50" : "", variant === "primary" ? "" : "");
  const content = (
    <>
      {icon}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} data-variant={variant}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className} data-variant={variant} onClick={onClick} disabled={disabled}>
      {content}
    </button>
  );
}

export function ToolbarSelect(props: { label: string }) {
  return (
    <button type="button" className="aw-toolbar-select">
      <span>{props.label}</span>
      <ChevronDown size={14} />
    </button>
  );
}

export function WorkspacePanel(props: {
  title?: string;
  heading?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { title, heading, action, className, children } = props;
  return (
    <section className={cn("aw-panel", className)}>
      <div className="aw-panel-inner">
        {(title || heading || action) ? (
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              {title ? <p className="aw-panel-title">{title}</p> : null}
              {heading ? <h2 className="aw-panel-heading mt-1">{heading}</h2> : null}
            </div>
            {action}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export function WorkspaceStatCard(props: {
  label: string;
  value: string;
  meta?: string;
  valueClassName?: string;
}) {
  return (
    <div className="aw-stat-card">
      <p className="aw-stat-label">{props.label}</p>
      <p className={cn("aw-stat-value", props.valueClassName)}>{props.value}</p>
      {props.meta ? <p className="mt-2 text-sm text-[var(--aw-text-muted)]">{props.meta}</p> : null}
    </div>
  );
}

export function WorkspaceEmpty(props: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("aw-empty-canvas", props.className)}>
      <div className="max-w-md">
        {props.icon ? (
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-[var(--aw-primary)]">
            {props.icon}
          </div>
        ) : null}
        <p className="text-lg font-semibold text-[var(--aw-text)]">{props.title}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--aw-text-muted)]">{props.description}</p>
        {props.action ? <div className="mt-5 flex justify-center">{props.action}</div> : null}
      </div>
    </div>
  );
}

export function ChartPlaceholder(props: {
  value?: string;
  meta?: string;
  xLabel?: string;
  yLabels?: string[];
  pointStyle?: { left: string; top: string };
  heightClassName?: string;
}) {
  const yLabels = props.yLabels ?? ["$3", "$2", "$1", "$0", "-$1"];
  return (
    <div>
      {(props.value || props.meta) ? (
        <div className="mb-4 flex items-end gap-3">
          {props.value ? <p className="text-3xl font-semibold tracking-[-0.03em] text-[var(--aw-text)]">{props.value}</p> : null}
          {props.meta ? <p className="pb-1 text-sm text-[var(--aw-text-muted)]">{props.meta}</p> : null}
        </div>
      ) : null}
      <div className={cn("aw-chart-shell", props.heightClassName)}>
        <div className="aw-chart-grid" />
        <div className="absolute inset-y-6 left-3 flex flex-col justify-between text-[10px] text-[var(--aw-text-muted)]">
          {yLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="absolute inset-x-16 bottom-5 flex justify-center text-[10px] text-[var(--aw-text-muted)]">
          <span>{props.xLabel ?? "Mar"}</span>
        </div>
        {props.pointStyle ? <span className="aw-chart-point" style={props.pointStyle} /> : null}
      </div>
    </div>
  );
}
