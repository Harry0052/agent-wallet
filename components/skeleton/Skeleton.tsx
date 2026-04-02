"use client";

import { type CSSProperties, type ReactNode } from "react";

/* ── Shimmer animation ── */

const shimmerKeyframes = `
@keyframes aw-skeleton-shimmer {
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
`;

let injected = false;
function ensureShimmerStyles() {
  if (typeof document === "undefined" || injected) return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = shimmerKeyframes;
  document.head.appendChild(style);
}

/* ── Base Skeleton ── */

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: CSSProperties;
  circle?: boolean;
}

export function Skeleton({
  width,
  height = 16,
  borderRadius,
  className = "",
  style,
  circle,
}: SkeletonProps) {
  ensureShimmerStyles();

  const size = circle ? (width ?? height) : undefined;
  const resolvedRadius = circle
    ? "50%"
    : borderRadius ?? "var(--aw-radius-md)";

  return (
    <div
      aria-hidden
      className={`aw-skeleton ${className}`}
      style={{
        width: circle ? size : (width ?? "100%"),
        height: circle ? size : height,
        borderRadius: resolvedRadius,
        background:
          "linear-gradient(90deg, var(--aw-surface-muted) 0%, var(--aw-surface-emphasis) 40%, var(--aw-surface-muted) 80%)",
        backgroundSize: "800px 100%",
        animation: "aw-skeleton-shimmer 1.6s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/* ── Skeleton Text (multiple rows) ── */

interface SkeletonTextProps {
  lines?: number;
  lineHeight?: number;
  gap?: number;
  lastLineWidth?: string;
  className?: string;
}

export function SkeletonText({
  lines = 3,
  lineHeight = 12,
  gap = 10,
  lastLineWidth = "60%",
  className = "",
}: SkeletonTextProps) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          height={lineHeight}
          width={i === lines - 1 ? lastLineWidth : "100%"}
        />
      ))}
    </div>
  );
}

/* ── Skeleton Card ── */

interface SkeletonCardProps {
  className?: string;
  children?: ReactNode;
}

export function SkeletonCard({ className = "", children }: SkeletonCardProps) {
  return (
    <div
      className={`aw-card ${className}`}
      aria-hidden
      style={{ pointerEvents: "none" }}
    >
      {children ?? (
        <>
          <Skeleton width="45%" height={14} style={{ marginBottom: 14 }} />
          <Skeleton width="30%" height={24} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 16 }} />
          <SkeletonText lines={2} lineHeight={11} gap={8} lastLineWidth="70%" />
        </>
      )}
    </div>
  );
}

/* ── Skeleton Stat Card (matches aw-stat-card) ── */

export function SkeletonStatCard({ className = "" }: { className?: string }) {
  return (
    <div className={`aw-stat-card ${className}`} aria-hidden>
      <Skeleton width="55%" height={10} style={{ marginBottom: 12 }} />
      <Skeleton width="40%" height={22} borderRadius="var(--aw-radius-md)" />
    </div>
  );
}

/* ── Skeleton Table ── */

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  showHeader = true,
  className = "",
}: SkeletonTableProps) {
  return (
    <div className={`aw-card-table ${className}`} aria-hidden>
      {showHeader && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 16,
            padding: "14px 16px",
            borderBottom: "1px solid var(--aw-border)",
          }}
        >
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} width={`${50 + Math.random() * 30}%`} height={10} />
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 16,
            padding: "16px",
            borderTop: row > 0 ? "1px solid var(--aw-border)" : undefined,
          }}
        >
          {Array.from({ length: columns }, (_, col) => (
            <Skeleton
              key={col}
              width={col === 0 ? "75%" : `${40 + Math.random() * 35}%`}
              height={col === 0 ? 14 : 12}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Skeleton Chart ── */

interface SkeletonChartProps {
  height?: number;
  className?: string;
}

export function SkeletonChart({ height = 240, className = "" }: SkeletonChartProps) {
  return (
    <div
      className={`aw-chart-shell ${className}`}
      style={{ minHeight: height }}
      aria-hidden
    >
      <div className="aw-chart-grid" />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "60%", display: "flex", alignItems: "flex-end", gap: 2, padding: "0 20px 20px" }}>
        {Array.from({ length: 12 }, (_, i) => {
          const h = 20 + Math.sin(i * 0.8) * 30 + Math.random() * 25;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h}%`,
                borderRadius: "4px 4px 0 0",
                background: "linear-gradient(90deg, var(--aw-surface-muted) 0%, var(--aw-surface-emphasis) 40%, var(--aw-surface-muted) 80%)",
                backgroundSize: "800px 100%",
                animation: "aw-skeleton-shimmer 1.6s ease-in-out infinite",
                animationDelay: `${i * 0.08}s`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Skeleton Form ── */

interface SkeletonFormProps {
  fields?: number;
  className?: string;
}

export function SkeletonForm({ fields = 4, className = "" }: SkeletonFormProps) {
  return (
    <div className={className} aria-hidden style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Skeleton width={`${60 + Math.random() * 20}%`} height={10} style={{ marginBottom: 8 }} />
          <Skeleton width="100%" height={40} borderRadius="var(--aw-radius-md)" />
        </div>
      ))}
      <Skeleton width={120} height={40} borderRadius="var(--aw-radius-pill)" style={{ marginTop: 4 }} />
    </div>
  );
}

/* ── Page Skeleton (full-page ghost layout) ── */

interface PageSkeletonProps {
  variant?: "workspace" | "page";
  className?: string;
}

export function PageSkeleton({ variant = "workspace", className = "" }: PageSkeletonProps) {
  const containerClass = variant === "workspace" ? "aw-workspace-page" : "aw-page";
  return (
    <div className={`${containerClass} ${className}`} aria-hidden>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="35%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
        <Skeleton width="50%" height={13} />
      </div>
      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Table */}
      <SkeletonTable rows={6} columns={4} />
    </div>
  );
}

/* ── Section Skeleton (reusable section block) ── */

interface SectionSkeletonProps {
  className?: string;
  children?: ReactNode;
}

export function SectionSkeleton({ className = "", children }: SectionSkeletonProps) {
  return (
    <div className={className} aria-hidden>
      {children ?? (
        <div className="aw-card">
          <Skeleton width="40%" height={14} style={{ marginBottom: 16 }} />
          <SkeletonText lines={4} lineHeight={12} gap={10} />
        </div>
      )}
    </div>
  );
}

/* ── Button Loading State ── */

interface ButtonLoadingStateProps {
  className?: string;
  width?: number | string;
  height?: number;
}

export function ButtonLoadingState({
  className = "",
  width = 100,
  height = 38,
}: ButtonLoadingStateProps) {
  return (
    <Skeleton
      width={width}
      height={height}
      borderRadius="var(--aw-radius-pill)"
      className={className}
    />
  );
}

/* ── Inline Spinner (kept for micro-interactions) ── */

export function InlineSpinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "2px solid var(--aw-surface-emphasis)",
        borderTopColor: "var(--aw-primary)",
        animation: "spin 0.8s linear infinite",
      }}
      aria-label="Loading"
    />
  );
}
