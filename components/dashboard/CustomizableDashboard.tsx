import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import type { ComponentType, HTMLAttributes } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { LayoutGrid, Sparkles } from "lucide-react";
import { PrimaryInsightCard } from "@/components/dashboard/PrimaryInsightCard";
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
import { cn } from "@/lib/utils";
import type { DashboardPreferences, DashboardWidgetId, DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

const widgetRenderers: Record<DashboardWidgetId, ComponentType<DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }>> = {
  okayToSpend: memo(OkayToSpendWidget),
  budget: memo(BudgetWidget),
  creditScore: memo(CreditScoreWidget),
  netWorth: memo(NetWorthWidget),
  goals: memo(GoalsWidget),
  gettingStarted: memo(GettingStartedWidget),
  spending: memo(SpendingWidget),
  transactions: memo(TransactionsWidget),
  recurring: memo(RecurringWidget),
  investments: memo(InvestmentsWidget),
  advice: memo(AdviceWidget),
};

interface CustomizableDashboardProps extends DashboardWidgetProps {
  greeting: string;
}

interface SortableWidgetProps {
  id: DashboardWidgetId;
  widgetProps: DashboardWidgetProps;
  onHideWidget?: (id: DashboardWidgetId) => void;
}

function SortableWidget({ id, widgetProps, onHideWidget }: SortableWidgetProps) {
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

  const extraProps = id === "gettingStarted" && onHideWidget
    ? { onHide: () => onHideWidget("gettingStarted") }
    : {};

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging ? "z-30" : "")}>
      <motion.div layout className={cn(isDragging ? "scale-[1.01] opacity-90" : "opacity-100")}>
        <Widget {...widgetProps} {...extraProps} dragHandleProps={{ ...attributes, ...listeners }} />
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
  const effectiveWidgetProps = useMemo(() => ({
    ...widgetProps,
    useLiveData: preferences.useLiveData,
  }), [widgetProps, preferences.useLiveData]);
  const liveMode = effectiveWidgetProps.useLiveData && effectiveWidgetProps.accountsConnected;
  const trackedSourceCount = widgetProps.dataSource.accounts.length;
  const primaryActionHref = liveMode ? null : "/connect";

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
      <div className="relative min-h-screen overflow-hidden bg-[var(--aw-bg)] text-[var(--aw-text)]">
        <div className="relative mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-6 md:px-8 md:py-8 xl:px-10">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-[var(--aw-border)] bg-[var(--aw-surface-1)] px-5 py-4 shadow-[0_4px_12px_rgba(17,17,17,0.05)] md:px-6"
          >
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--aw-text)] md:text-3xl">{greeting}</h1>
              <div className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--aw-text-muted)]">
                {liveMode ? "Live" : "Setup"}
              </div>
              <div className="hidden rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-1 text-xs text-[var(--aw-text-muted)] sm:inline-flex">
                {trackedSourceCount} source{trackedSourceCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {primaryActionHref ? (
                <Link
                  href={primaryActionHref}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--aw-primary)] px-5 text-sm font-semibold text-[var(--aw-text)] shadow-[0_4px_18px_rgba(253,186,116,0.42)] transition hover:bg-[var(--aw-primary-strong)]"
                >
                  Connect an account
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCustomizeOpen(true)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--aw-primary)] px-5 text-sm font-semibold text-[var(--aw-text)] shadow-[0_4px_18px_rgba(253,186,116,0.42)] transition hover:bg-[var(--aw-primary-strong)]"
                >
                  <LayoutGrid size={16} />
                  Customize
                </button>
              )}
            </div>
          </motion.section>

          {/* Actionable insight card — always visible above widgets */}
          <PrimaryInsightCard home={widgetProps.home} />

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
                    <SortableWidget id={widgetId} widgetProps={effectiveWidgetProps} onHideWidget={handleToggleWidget} />
                  </motion.div>
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeWidget ? (
                <div className="w-[320px] rounded-[20px] border border-[var(--aw-border)] bg-[var(--aw-surface-1)] p-5 shadow-[0_12px_28px_rgba(17,17,17,0.1)]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--aw-text-muted)]">Moving widget</p>
                  <p className="mt-3 text-base font-semibold text-[var(--aw-text)]">{activeWidget.label}</p>
                  <p className="mt-2 text-sm text-[var(--aw-text-muted)]">{activeWidget.description}</p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {orderedWidgetIds.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-[var(--aw-border)] bg-[var(--aw-surface-1)] px-6 py-16 text-center shadow-[0_4px_12px_rgba(17,17,17,0.05)]">
              <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-[20px] bg-[rgba(253,186,116,0.2)] text-[var(--aw-primary)]">
                <Sparkles size={22} />
              </div>
              <p className="mt-5 text-xl font-semibold text-[var(--aw-text)]">All widgets are hidden</p>
              <p className="mt-2 text-sm leading-6 text-[var(--aw-text-muted)]">Open Customize to turn widgets back on or reset the dashboard layout.</p>
              <button
                type="button"
                onClick={() => setIsCustomizeOpen(true)}
                className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-[var(--aw-primary)] px-5 text-sm font-semibold text-[var(--aw-text)] transition hover:bg-[var(--aw-primary-strong)]"
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
