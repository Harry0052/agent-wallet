"use client";

import { C } from "./landingConstants";

export function LandingFooter() {
  return (
    <footer className="px-6 py-14 md:px-10" style={{ background: C.warmWhite }}>
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-10 grid grid-cols-2 gap-8 md:grid-cols-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <img src="/calico-icon.png" alt="Calico" style={{ width: 22, height: 22, borderRadius: 5, objectFit: "cover" }} />
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.textPrimary, fontFamily: C.fontFamily }}>
                Calico
              </p>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: C.textSecondary, lineHeight: 1.65 }}>
              The friendly money app that actually understands you.
            </p>
          </div>

          <div>
            <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted }}>
              Product
            </p>
            {["Home", "Transactions", "Recurring", "Insights"].map((l) => (
              <a
                key={l}
                href="#"
                className="mb-2 block text-sm transition-colors"
                style={{ color: C.textSecondary }}
                onMouseEnter={(e) => (e.currentTarget.style.color = C.textPrimary)}
                onMouseLeave={(e) => (e.currentTarget.style.color = C.textSecondary)}
              >
                {l}
              </a>
            ))}
          </div>

          <div>
            <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted }}>
              Company
            </p>
            {["About", "Security", "Privacy", "Terms"].map((l) => (
              <a
                key={l}
                href="#"
                className="mb-2 block text-sm transition-colors"
                style={{ color: C.textSecondary }}
                onMouseEnter={(e) => (e.currentTarget.style.color = C.textPrimary)}
                onMouseLeave={(e) => (e.currentTarget.style.color = C.textSecondary)}
              >
                {l}
              </a>
            ))}
          </div>

          <div>
            <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted }}>
              Follow
            </p>
            {["Twitter / X", "LinkedIn"].map((l) => (
              <a
                key={l}
                href="#"
                className="mb-2 block text-sm transition-colors"
                style={{ color: C.textSecondary }}
                onMouseEnter={(e) => (e.currentTarget.style.color = C.textPrimary)}
                onMouseLeave={(e) => (e.currentTarget.style.color = C.textSecondary)}
              >
                {l}
              </a>
            ))}
          </div>
        </div>

        <div
          className="flex flex-col gap-2 border-t pt-6 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: C.border }}
        >
          <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>&copy; 2025 Calico. All rights reserved.</p>
          <div className="flex gap-4">
            {["Privacy", "Terms"].map((l) => (
              <a key={l} href="#" className="text-xs" style={{ color: C.textMuted }}>
                {l}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
