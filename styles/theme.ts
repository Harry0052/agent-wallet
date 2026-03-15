import type { CSSProperties } from "react";

export const calicoTheme = {
  // Core palette (must match landing page visual language)
  background: "#FFF7ED",
  card: "#FFFCF8",
  secondarySurface: "#FFF1E6",
  primary: "#FDBA74",
  primaryHover: "#FDBA74",
  primarySoft: "#FBCFE8",
  primarySecondary: "#FBCFE8",
  primarySecondarySoft: "#FDE68A",
  success: "#16A34A",
  warning: "#FDE68A",
  negative: "#DC2626",
  text: "#111111",
  textSoft: "#3A332E",
  textMuted: "#6B5B4B",
  border: "#F2DECC",
  hover: "#FFF1E6",

  // Typography (must match landing page)
  fontFamily: "\"DM Sans\", sans-serif",
  fontWeightHeader: 700,
  fontWeightBody: 400,
  fontWeightNumber: 600,

  // Radius + spacing system
  radiusCard: 20,
  radiusCardLarge: 24,
  radiusButton: 999,
  radiusInput: 12,
  pagePadding: 32,
  sectionSpacing: 24,
  cardSpacing: 20,
  rowSpacing: 12,
  transitionFast: "0.15s ease",

  // Shadows
  shadowSoft: "0 2px 12px rgba(17,17,17,0.06)",
  shadowMd: "0 4px 24px rgba(17,17,17,0.08)",
  shadowLg: "0 12px 48px rgba(17,17,17,0.1)",

  // Chart system
  chartPrimary: "#FDBA74",
  chartSecondary: "#FBCFE8",
  chartPositive: "#16A34A",
  chartNegative: "#DC2626",
  chartGrid: "#F2DECC",
} as const;

export const calicoThemeVars: CSSProperties = {
  ["--calico-background" as string]: calicoTheme.background,
  ["--calico-card" as string]: calicoTheme.card,
  ["--calico-secondary-surface" as string]: calicoTheme.secondarySurface,
  ["--calico-primary" as string]: calicoTheme.primary,
  ["--calico-primary-hover" as string]: calicoTheme.primaryHover,
  ["--calico-primary-soft" as string]: calicoTheme.primarySoft,
  ["--calico-primary-secondary" as string]: calicoTheme.primarySecondary,
  ["--calico-primary-secondary-soft" as string]:
    calicoTheme.primarySecondarySoft,
  ["--calico-success" as string]: calicoTheme.success,
  ["--calico-warning" as string]: calicoTheme.warning,
  ["--calico-negative" as string]: calicoTheme.negative,
  ["--calico-text" as string]: calicoTheme.text,
  ["--calico-text-soft" as string]: calicoTheme.textSoft,
  ["--calico-text-muted" as string]: calicoTheme.textMuted,
  ["--calico-border" as string]: calicoTheme.border,
  ["--calico-hover" as string]: calicoTheme.hover,
  ["--calico-radius-card" as string]: `${calicoTheme.radiusCard}px`,
  ["--calico-radius-card-large" as string]: `${calicoTheme.radiusCardLarge}px`,
  ["--calico-radius-button" as string]: `${calicoTheme.radiusButton}px`,
  ["--calico-radius-input" as string]: `${calicoTheme.radiusInput}px`,
  ["--calico-page-padding" as string]: `${calicoTheme.pagePadding}px`,
  ["--calico-section-spacing" as string]: `${calicoTheme.sectionSpacing}px`,
  ["--calico-card-spacing" as string]: `${calicoTheme.cardSpacing}px`,
  ["--calico-row-spacing" as string]: `${calicoTheme.rowSpacing}px`,
  ["--calico-transition-fast" as string]: calicoTheme.transitionFast,
  ["--calico-shadow-soft" as string]: calicoTheme.shadowSoft,
  ["--calico-shadow-md" as string]: calicoTheme.shadowMd,
  ["--calico-shadow-lg" as string]: calicoTheme.shadowLg,
  ["--calico-chart-primary" as string]: calicoTheme.chartPrimary,
  ["--calico-chart-secondary" as string]: calicoTheme.chartSecondary,
  ["--calico-chart-positive" as string]: calicoTheme.chartPositive,
  ["--calico-chart-negative" as string]: calicoTheme.chartNegative,
  ["--calico-chart-grid" as string]: calicoTheme.chartGrid,
};
