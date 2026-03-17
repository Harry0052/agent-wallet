import { useEffect, useMemo, useState } from "react";
import type { ComponentType, HTMLAttributes } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { LayoutGrid, Sparkles } from "lucide-react";
import { AdviceWidget } from "@/components/dashboard/AdviceWidget";
import { BudgetWidget } from "@/components/dashboard/BudgetWidget";
import { OkayToSpendWidget } from "@/components/dashboard/OkayToSpendWidget";
import { CreditScoreWidget } from "@/components/dashboard/CreditScoreWidget";
import { CustomizeDashboardPanel } from "@/components/dashboard/CustomizeDashboardPanel";
import { GettingStartedWidget } from "@/components/dashboard/GettingStartedWidget";
import { GoalsWidget } from "@/components/dashboard/GoalsWidget";
import { InvestmentsWidget } from "@/components/dashboard/InvestmentsWidget";
import { NetWorthWidget } from "@/components/dashboard/NetWorthWidget";
import { RecurringWidget } from "@/components/dashboard/RecurringWidget";
import { SpendingWidget } from "@/components/dashboard/SpendingWidget";
import { TransactionsWidget } from "@/components/dashboard/TransactionsWidget";
import {
  DASHBOARD_STORAGE_KEY,
  dashboardWidgets,
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
  widgetSpanClass,
} from "@/components/dashboard/dashboardRegistry";
import { describeLiveMode } from "@/components/dashboard/dashboardData";
import { cn } from "@/lib/utils";
import { calicoThemeVars } from "@/styles/theme";
import type { DashboardPreferences, DashboardWidgetId, DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

const widgetRenderers: Record<DashboardWidgetId, ComponentType<DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }>> = {
  okayToSpend: OkayToSpendWidget,
  budget: BudgetWidget,
  creditScore: CreditScoreWidget,
  netWorth: NetWorthWidget,
  goals: GoalsWidget,
  gettingStarted: GettingStartedWidget,
  spending: SpendingWidget,
  transactions: TransactionsWidget,
  recurring: RecurringWidget,
  investments: InvestmentsWidget,
  advice: AdviceWidget,
};

interface CustomizableDashboardProps extends DashboardWidgetProps {
  greeting: string;
}

interface SortableWidgetProps {
  id: DashboardWidgetId;
  widgetProps: DashboardWidgetProps;
}

function SortableWidget({ id, widgetProps }: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const Widget = widgetRenderers[id];
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging ? "z-30" : "")}>
      <motion.div layout className={cn(isDragging ? "scale-[1.01] opacity-90" : "opacity-100")}>
        <Widget {...widgetProps} dragHandleProps={{ ...attributes, ...listeners }} />
      </motion.div>
    </div>
  );
}

export function CustomizableDashboard({ greeting, ...widgetProps }: CustomizableDashboardProps) {
  const [preferences, setPreferences] = useState<DashboardPreferences>(defaultDashboardPreferences);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [activeWidgetId, setActiveWidgetId] = useState<DashboardWidgetId | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (!stored) return;
      setPreferences(normalizeDashboardPreferences(JSON.parse(stored)));
    } catch {
      setPreferences(defaultDashboardPreferences);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const orderedWidgetIds = useMemo(
    () => preferences.order.filter((id) => preferences.visibility[id]),
    [preferences],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeWidget = activeWidgetId ? dashboardWidgets.find((widget) => widget.id === activeWidgetId) : null;
  const effectiveWidgetProps = {
    ...widgetProps,
    useLiveData: preferences.useLiveData,
  };
  const liveMode = effectiveWidgetProps.useLiveData && effectiveWidgetProps.accountsConnected;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveWidgetId(event.active.id as DashboardWidgetId);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveWidgetId(null);
    if (!over || active.id === over.id) return;
    setPreferences((current) => ({
      ...current,
      order: arrayMove(current.order, current.order.indexOf(active.id as DashboardWidgetId), current.order.indexOf(over.id as DashboardWidgetId)),
    }));
  };

  const handleToggleWidget = (widgetId: DashboardWidgetId) => {
    setPreferences((current) => ({
      ...current,
      visibility: {
        ...current.visibility,
        [widgetId]: !current.visibility[widgetId],
      },
    }));
  };

  return (
    <>
      <div style={calicoThemeVars} className="relative min-h-screen overflow-hidden bg-[var(--calico-background)] text-[var(--calico-text)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,207,232,0.24),transparent_28%),radial-gradient(circle_at_top_right,rgba(253,230,138,0.2),transparent_22%),linear-gradient(180deg,#FFF7ED_0%,#FFFCF8_100%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:linear-gradient(rgba(253,186,116,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(253,186,116,0.1)_1px,transparent_1px)] [background-size:90px_90px]" />

        <div className="relative mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8 xl:px-10">
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: "easeOut" }}
            className="overflow-hidden rounded-[20px] border border-[var(--calico-border)] bg-[var(--calico-card)] p-6 shadow-[0_4px_12px_rgba(17,17,17,0.05)]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,207,232,0.26),transparent_34%),linear-gradient(135deg,rgba(255,252,248,0.98),rgba(255,241,230,0.94))]" />
            <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-[var(--calico-primary)]">Your Dashboard</p>
                <h1 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-[var(--calico-text)] md:text-5xl">{greeting}</h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--calico-text-muted)]">
                  Here's your money at a glance. Drag things around to set it up the way you like.
                </p>
              </div>

              <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
                <div className="rounded-[20px] border border-[var(--calico-border)] bg-[var(--calico-hover)] px-4 py-3">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[var(--calico-text-muted)]">Data mode</p>
                  <p className="mt-2 text-sm text-[var(--calico-text)]">{liveMode ? "Live data mode" : "Placeholder mode"}</p>
                  <p className="mt-1 text-xs text-[var(--calico-text-muted)]">{describeLiveMode(liveMode)}</p>
                </div>
                <div className="rounded-[20px] border border-[var(--calico-border)] bg-[var(--calico-hover)] px-4 py-3">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[var(--calico-text-muted)]">Sources</p>
                  <p className="mt-2 text-sm text-[var(--calico-text)]">{widgetProps.dataSource.accounts.length} account source{widgetProps.dataSource.accounts.length === 1 ? "" : "s"} tracked</p>
                  <p className="mt-1 text-xs text-[var(--calico-text-muted)]">{widgetProps.home.freshness.label}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCustomizeOpen(true)}
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[var(--calico-primary)] px-5 text-sm font-semibold text-[var(--calico-text)] shadow-[0_4px_18px_rgba(253,186,116,0.42)] transition hover:bg-[var(--calico-primary-hover)]"
                >
                  <LayoutGrid size={17} />
                  Customize
                </button>
              </div>
            </div>
          </motion.section>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedWidgetIds} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-12 grid-flow-row-dense gap-6">
                {orderedWidgetIds.map((widgetId, index) => (
                  <motion.div
                    key={widgetId}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.04 * Math.min(index, 8), duration: 0.22, ease: "easeOut" }}
                    className={widgetSpanClass(widgetId)}
                  >
                    <SortableWidget id={widgetId} widgetProps={effectiveWidgetProps} />
                  </motion.div>
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeWidget ? (
                <div className="w-[320px] rounded-[20px] border border-[var(--calico-border)] bg-[var(--calico-card)] p-5 shadow-[0_12px_28px_rgba(17,17,17,0.1)]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--calico-text-muted)]">Moving widget</p>
                  <p className="mt-3 text-base font-semibold text-[var(--calico-text)]">{activeWidget.label}</p>
                  <p className="mt-2 text-sm text-[var(--calico-text-muted)]">{activeWidget.description}</p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {orderedWidgetIds.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-[var(--calico-border)] bg-[var(--calico-card)] px-6 py-16 text-center shadow-[0_4px_12px_rgba(17,17,17,0.05)]">
              <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-[20px] bg-[rgba(253,186,116,0.2)] text-[var(--calico-primary)]">
                <Sparkles size={22} />
              </div>
              <p className="mt-5 text-xl font-semibold text-[var(--calico-text)]">All widgets are hidden</p>
              <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">Open Customize to turn widgets back on or reset the dashboard layout.</p>
              <button
                type="button"
                onClick={() => setIsCustomizeOpen(true)}
                className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-[var(--calico-primary)] px-5 text-sm font-semibold text-[var(--calico-text)] transition hover:bg-[var(--calico-primary-hover)]"
              >
                Customize dashboard
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <CustomizeDashboardPanel
        open={isCustomizeOpen}
        preferences={preferences}
        onClose={() => setIsCustomizeOpen(false)}
        onToggleWidget={handleToggleWidget}
        onReset={() => setPreferences(defaultDashboardPreferences)}
        onToggleLiveData={() => setPreferences((current) => ({ ...current, useLiveData: !current.useLiveData }))}
      />
    </>
  );
}
