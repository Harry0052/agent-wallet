import { calicoTheme } from "@/styles/theme";
import type { CSSProperties } from "react";

export const C = {
  cream: calicoTheme.background,
  warmWhite: calicoTheme.card,
  apricot: calicoTheme.primary,
  apricotSoft: "rgba(253, 186, 116, 0.22)",
  caramel: calicoTheme.text,
  blush: calicoTheme.primarySecondary,
  blushSoft: "rgba(251, 207, 232, 0.26)",
  charcoal: calicoTheme.text,
  charcoalSoft: calicoTheme.textSoft,
  sage: calicoTheme.warning,
  sageSoft: "rgba(253, 230, 138, 0.28)",
  textPrimary: calicoTheme.text,
  textSecondary: calicoTheme.textSoft,
  textMuted: calicoTheme.textMuted,
  border: calicoTheme.border,
  surface: calicoTheme.card,
  shadow: calicoTheme.shadowSoft,
  shadowMd: calicoTheme.shadowMd,
  shadowLg: calicoTheme.shadowLg,
  success: calicoTheme.success,
  fontFamily: calicoTheme.fontFamily,
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
