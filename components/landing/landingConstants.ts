import { agentWalletTheme } from "@/styles/theme";
import type { CSSProperties } from "react";

export const C = {
  cream: agentWalletTheme.background,
  warmWhite: agentWalletTheme.card,
  apricot: agentWalletTheme.primary,
  apricotSoft: "rgba(253, 186, 116, 0.22)",
  caramel: agentWalletTheme.text,
  blush: agentWalletTheme.primarySecondary,
  blushSoft: "rgba(251, 207, 232, 0.26)",
  charcoal: agentWalletTheme.text,
  charcoalSoft: agentWalletTheme.textSoft,
  sage: agentWalletTheme.warning,
  sageSoft: "rgba(253, 230, 138, 0.28)",
  textPrimary: agentWalletTheme.text,
  textSecondary: agentWalletTheme.textSoft,
  textMuted: agentWalletTheme.textMuted,
  border: agentWalletTheme.border,
  surface: agentWalletTheme.card,
  shadow: agentWalletTheme.shadowSoft,
  shadowMd: agentWalletTheme.shadowMd,
  shadowLg: agentWalletTheme.shadowLg,
  success: agentWalletTheme.success,
  fontFamily: agentWalletTheme.fontFamily,
} as const;

export const cardBase: CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 24,
  boxShadow: C.shadow,
  padding: 32,
};

export const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(2rem, 4vw, 2.8rem)",
  fontWeight: 700,
  color: C.textPrimary,
  fontFamily: C.fontFamily,
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
};

export const subtitleStyle: CSSProperties = {
  fontSize: "1.1rem",
  lineHeight: 1.7,
  color: C.textSecondary,
};

export const overlineStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  lineHeight: 1,
};
