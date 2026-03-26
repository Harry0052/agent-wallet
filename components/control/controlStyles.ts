import type { CSSProperties } from "react";

export const acpTheme = {
  background: "#FFFFFF",
  surface: "#F8FAFC",
  surfaceHover: "#F1F5F9",
  primary: "#2563EB",
  primaryHover: "#1D4ED8",
  primarySoft: "rgba(37, 99, 235, 0.08)",
  success: "#16A34A",
  successSoft: "rgba(22, 163, 74, 0.08)",
  warning: "#D97706",
  warningSoft: "rgba(217, 119, 6, 0.08)",
  danger: "#DC2626",
  dangerSoft: "rgba(220, 38, 38, 0.06)",
  text: "#111827",
  textMuted: "#6B7280",
  textLight: "#9CA3AF",
  border: "#E5E7EB",
  borderLight: "#F3F4F6",
  radius: 12,
  radiusSmall: 8,
  radiusFull: 999,
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd: "0 4px 12px rgba(0,0,0,0.08)",
  fontFamily: '"DM Sans", sans-serif',
} as const;

// ── Reusable style objects ──────────────────────────────────────────────────

export const acpCard: CSSProperties = {
  background: acpTheme.background,
  border: `1px solid ${acpTheme.border}`,
  borderRadius: acpTheme.radius,
  boxShadow: acpTheme.shadow,
};

export const acpCardHover: CSSProperties = {
  ...acpCard,
  boxShadow: acpTheme.shadowMd,
};

export const acpSurface: CSSProperties = {
  background: acpTheme.surface,
  borderRadius: acpTheme.radius,
};

export const acpButtonPrimary: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 36,
  padding: "0 16px",
  borderRadius: acpTheme.radiusSmall,
  border: "none",
  background: acpTheme.primary,
  color: "#FFFFFF",
  fontSize: "0.82rem",
  fontWeight: 600,
  fontFamily: acpTheme.fontFamily,
  cursor: "pointer",
  transition: "background 0.15s ease, opacity 0.15s ease",
};

export const acpButtonSecondary: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 36,
  padding: "0 16px",
  borderRadius: acpTheme.radiusSmall,
  border: `1px solid ${acpTheme.border}`,
  background: acpTheme.background,
  color: acpTheme.textMuted,
  fontSize: "0.82rem",
  fontWeight: 600,
  fontFamily: acpTheme.fontFamily,
  cursor: "pointer",
  transition: "background 0.15s ease",
};

export const acpButtonText: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 36,
  padding: "0 8px",
  borderRadius: acpTheme.radiusSmall,
  border: "none",
  background: "transparent",
  color: acpTheme.primary,
  fontSize: "0.78rem",
  fontWeight: 600,
  fontFamily: acpTheme.fontFamily,
  cursor: "pointer",
  transition: "background 0.15s ease",
};

export const acpBadge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 10px",
  borderRadius: acpTheme.radiusFull,
  fontSize: "0.7rem",
  fontWeight: 600,
  letterSpacing: "0.02em",
};

export const acpHeading: CSSProperties = {
  fontSize: "1.35rem",
  fontWeight: 700,
  fontFamily: acpTheme.fontFamily,
  color: acpTheme.text,
  letterSpacing: "-0.02em",
  lineHeight: 1.3,
};

export const acpSubheading: CSSProperties = {
  fontSize: "0.82rem",
  fontWeight: 500,
  fontFamily: acpTheme.fontFamily,
  color: acpTheme.textMuted,
  lineHeight: 1.5,
};

export const acpLabel: CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  fontFamily: acpTheme.fontFamily,
  color: acpTheme.textMuted,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
};

export const acpOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

export const acpBackdrop: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(0, 0, 0, 0.25)",
  backdropFilter: "blur(4px)",
};

/** Risk-level color map */
export const RISK_COLORS = {
  low: { color: acpTheme.success, bg: acpTheme.successSoft, border: "rgba(22, 163, 74, 0.2)" },
  medium: { color: acpTheme.warning, bg: acpTheme.warningSoft, border: "rgba(217, 119, 6, 0.2)" },
  high: { color: "#EA580C", bg: "rgba(234, 88, 12, 0.08)", border: "rgba(234, 88, 12, 0.2)" },
  critical: { color: acpTheme.danger, bg: acpTheme.dangerSoft, border: "rgba(220, 38, 38, 0.2)" },
} as const;

export type RiskLevel = keyof typeof RISK_COLORS;
