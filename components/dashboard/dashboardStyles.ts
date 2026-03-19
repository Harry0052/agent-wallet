import type { CSSProperties } from "react";
import { calicoTheme } from "@/styles/theme";

export const dashboardSurfaceStyle: CSSProperties = {
  background: calicoTheme.card,
  border: `1px solid ${calicoTheme.border}`,
  boxShadow: "0 1px 3px rgba(17, 17, 17, 0.03), 0 4px 16px rgba(17, 17, 17, 0.03)",
};

export const dashboardHoverShadow = "0 2px 8px rgba(17, 17, 17, 0.05), 0 8px 24px rgba(17, 17, 17, 0.05)";

export const dashboardInsetStyle: CSSProperties = {
  background: calicoTheme.hover,
  border: `1px solid ${calicoTheme.border}`,
};

export const dashboardDashedStyle: CSSProperties = {
  background: "transparent",
  border: `1.5px dashed rgba(242, 222, 204, 0.7)`,
};

export const dashboardPrimaryButtonStyle: CSSProperties = {
  background: calicoTheme.primary,
  border: `1px solid ${calicoTheme.primary}`,
  borderRadius: calicoTheme.radiusButton,
  boxShadow: "0 2px 8px rgba(253, 186, 116, 0.3)",
  color: calicoTheme.text,
};

export const dashboardSecondaryButtonStyle: CSSProperties = {
  background: calicoTheme.card,
  border: `1px solid ${calicoTheme.border}`,
  borderRadius: calicoTheme.radiusButton,
  color: calicoTheme.text,
};

export const dashboardChipStyle: CSSProperties = {
  background: "rgba(255, 241, 230, 0.6)",
  border: `1px solid rgba(242, 222, 204, 0.5)`,
  color: calicoTheme.textMuted,
};
