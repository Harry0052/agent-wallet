import type { CSSProperties } from "react";
import { calicoTheme } from "@/styles/theme";

export const dashboardSurfaceStyle: CSSProperties = {
  background: calicoTheme.card,
  border: `1px solid ${calicoTheme.border}`,
  boxShadow: calicoTheme.shadowSoft,
};

export const dashboardHoverShadow = "0 6px 18px rgba(15, 23, 42, 0.08)";

export const dashboardInsetStyle: CSSProperties = {
  background: calicoTheme.hover,
  border: `1px solid ${calicoTheme.border}`,
};

export const dashboardDashedStyle: CSSProperties = {
  background: calicoTheme.hover,
  border: `1px dashed ${calicoTheme.border}`,
};

export const dashboardPrimaryButtonStyle: CSSProperties = {
  background: calicoTheme.primary,
  border: `1px solid ${calicoTheme.primary}`,
  borderRadius: calicoTheme.radiusButton,
  boxShadow: "0 4px 18px rgba(253, 186, 116, 0.42)",
  color: calicoTheme.text,
};

export const dashboardSecondaryButtonStyle: CSSProperties = {
  background: calicoTheme.card,
  border: `1px solid ${calicoTheme.border}`,
  borderRadius: calicoTheme.radiusButton,
  color: calicoTheme.text,
};

export const dashboardChipStyle: CSSProperties = {
  background: calicoTheme.hover,
  border: `1px solid ${calicoTheme.border}`,
  color: calicoTheme.textMuted,
};
