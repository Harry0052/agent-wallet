import { AnimatePresence, motion } from "framer-motion";
import { RotateCcw, X } from "lucide-react";
import { dashboardWidgets } from "@/components/dashboard/dashboardRegistry";
import { agentWalletTheme, agentWalletThemeVars } from "@/styles/theme";
import type { DashboardPreferences, DashboardWidgetId } from "@/components/dashboard/dashboardTypes";

interface CustomizeDashboardPanelProps {
  open: boolean;
  preferences: DashboardPreferences;
  onClose: () => void;
  onToggleWidget: (widgetId: DashboardWidgetId) => void;
  onReset: () => void;
  onToggleLiveData: () => void;
}

export function CustomizeDashboardPanel({
  open,
  preferences,
  onClose,
  onToggleWidget,
  onReset,
  onToggleLiveData,
}: CustomizeDashboardPanelProps) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close customize dashboard"
            className="aw-overlay-soft fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            style={agentWalletThemeVars}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 28 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed right-4 top-4 z-50 flex h-[calc(100vh-2rem)] w-full max-w-sm flex-col rounded-[20px] border border-[var(--aw-border)] bg-[var(--aw-surface-1)] p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--aw-text-muted)]">Customize dashboard</p>
                <p className="mt-2 text-sm text-[var(--aw-text-muted)]">Toggle visibility, switch data modes, or reset the layout.</p>
              </div>
              <button
                type="button"
                aria-label="Close panel"
                className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-[var(--aw-text-muted)] transition hover:bg-[var(--aw-surface-1)] hover:text-[var(--aw-text)]"
                onClick={onClose}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 rounded-[20px] border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--aw-text)]">Real-data integration</p>
                  <p className="mt-1 text-sm text-[var(--aw-text-muted)]">When enabled, widgets swap from placeholders to connected account data where available.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.useLiveData}
                  onClick={onToggleLiveData}
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition ${preferences.useLiveData ? "bg-[var(--aw-primary)]" : "bg-[var(--aw-border)]"}`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-[0_2px_6px_rgba(15,23,42,0.12)] transition ${preferences.useLiveData ? "left-6" : "left-1"}`}
                  />
                </button>
              </div>
            </div>

            <div className="mt-6 flex-1 overflow-y-auto pr-1">
              <div className="space-y-2">
                {dashboardWidgets.map((widget) => (
                  <label key={widget.id} className="flex cursor-pointer items-start gap-3 rounded-[20px] border border-[var(--aw-border)] bg-[var(--aw-surface-1)] px-4 py-3 text-sm transition hover:bg-[var(--aw-surface-subtle)]">
                    <input
                      type="checkbox"
                      checked={preferences.visibility[widget.id]}
                      onChange={() => onToggleWidget(widget.id)}
                      className="mt-1 h-4 w-4 rounded border-[var(--aw-border)] text-[var(--aw-primary)] focus:ring-[var(--aw-primary)]"
                    />
                    <span>
                      <span className="block font-semibold text-[var(--aw-text)]">{widget.label}</span>
                      <span className="mt-1 block text-[var(--aw-text-muted)]">{widget.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={onReset}
              className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-sm font-semibold text-[var(--aw-text)] transition hover:bg-[var(--aw-surface-1)]"
            >
              <RotateCcw size={16} color={agentWalletTheme.text} />
              Reset layout
            </button>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
