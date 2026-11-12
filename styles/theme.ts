import type { CSSProperties } from "react";

export const agentWalletTheme = {
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

export const agentWalletThemeVars: CSSProperties = {
  ["--aw-bg" as string]: agentWalletTheme.background,
  ["--aw-surface-1" as string]: agentWalletTheme.card,
  ["--aw-surface-subtle" as string]: agentWalletTheme.secondarySurface,
  ["--aw-primary" as string]: agentWalletTheme.primary,
  ["--aw-primary-strong" as string]: agentWalletTheme.primaryHover,
  ["--aw-primary-soft" as string]: agentWalletTheme.primarySoft,
  ["--aw-primary-secondary" as string]: agentWalletTheme.primarySecondary,
  ["--aw-primary-secondary-soft" as string]:
    agentWalletTheme.primarySecondarySoft,
  ["--aw-success" as string]: agentWalletTheme.success,
  ["--aw-warning" as string]: agentWalletTheme.warning,
  ["--aw-danger" as string]: agentWalletTheme.negative,
  ["--aw-text" as string]: agentWalletTheme.text,
  ["--aw-text-soft" as string]: agentWalletTheme.textSoft,
  ["--aw-text-muted" as string]: agentWalletTheme.textMuted,
  ["--aw-border" as string]: agentWalletTheme.border,
  ["--aw-radius-lg" as string]: `${agentWalletTheme.radiusCard}px`,
  ["--aw-radius-xl" as string]: `${agentWalletTheme.radiusCardLarge}px`,
  ["--aw-radius-pill" as string]: `${agentWalletTheme.radiusButton}px`,
  ["--aw-radius-md" as string]: `${agentWalletTheme.radiusInput}px`,
  ["--aw-space-page" as string]: `${agentWalletTheme.pagePadding}px`,
  ["--aw-space-section" as string]: `${agentWalletTheme.sectionSpacing}px`,
  ["--aw-space-card" as string]: `${agentWalletTheme.cardSpacing}px`,
  ["--aw-space-row" as string]: `${agentWalletTheme.rowSpacing}px`,
  ["--aw-transition-fast" as string]: agentWalletTheme.transitionFast,
  ["--aw-shadow-soft" as string]: agentWalletTheme.shadowSoft,
  ["--aw-shadow-md" as string]: agentWalletTheme.shadowMd,
  ["--aw-shadow" as string]: agentWalletTheme.shadowLg,
  ["--aw-chart-primary" as string]: agentWalletTheme.chartPrimary,
  ["--aw-chart-secondary" as string]: agentWalletTheme.chartSecondary,
  ["--aw-chart-positive" as string]: agentWalletTheme.chartPositive,
  ["--aw-chart-negative" as string]: agentWalletTheme.chartNegative,
  ["--aw-chart-grid" as string]: agentWalletTheme.chartGrid,
};
