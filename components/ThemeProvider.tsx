"use client";

import { migrateLegacyBrowserStorage } from "@/lib/browserStorage";

/**
 * Agent Wallet uses a warm light-only theme. No dark mode.
 * This provider is kept as a wrapper for potential future theming but
 * always applies the light Agent Wallet palette.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  migrateLegacyBrowserStorage();
  return <>{children}</>;
}
