import type { CSSProperties } from "react";
import { agentWalletTheme } from "@/styles/theme";

export const dashboardSurfaceStyle: CSSProperties = {
  background: agentWalletTheme.card,
  boxShadow: "0 1px 2px rgba(17, 17, 17, 0.02), 0 2px 10px rgba(17, 17, 17, 0.03)",
};

export const dashboardHoverShadow = "0 2px 6px rgba(17, 17, 17, 0.04), 0 6px 20px rgba(17, 17, 17, 0.05)";

export const dashboardInsetStyle: CSSProperties = {
  background: "rgba(255, 247, 237, 0.4)",
};

export const dashboardDashedStyle: CSSProperties = {
  background: "transparent",
  border: `1px dashed rgba(242, 222, 204, 0.5)`,
};

export const dashboardPrimaryButtonStyle: CSSProperties = {
  background: agentWalletTheme.primary,
  borderRadius: agentWalletTheme.radiusButton,
  boxShadow: "0 2px 8px rgba(253, 186, 116, 0.3)",
  color: agentWalletTheme.text,
};

export const dashboardSecondaryButtonStyle: CSSProperties = {
  background: agentWalletTheme.card,
  border: `1px solid rgba(242, 222, 204, 0.6)`,
  borderRadius: agentWalletTheme.radiusButton,
  color: agentWalletTheme.text,
};

export const dashboardChipStyle: CSSProperties = {
  background: "rgba(255, 241, 230, 0.5)",
  color: agentWalletTheme.textMuted,
};
