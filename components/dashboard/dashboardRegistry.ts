import type { DashboardPreferences, DashboardWidgetDefinition, DashboardWidgetId } from "@/components/dashboard/dashboardTypes";

export const DASHBOARD_STORAGE_KEY = "calico.custom-dashboard.v1";

export const dashboardWidgets: DashboardWidgetDefinition[] = [
  { id: "okayToSpend", label: "Okay to Spend", description: "Money you can use right now", span: "compact" },
  { id: "budget", label: "Spending Plan", description: "How much you planned to spend this month", span: "compact" },
  { id: "creditScore", label: "Credit Score", description: "Your credit score at a glance", span: "compact" },
  { id: "netWorth", label: "Total Money", description: "Everything you have minus what you owe", span: "wide" },
  { id: "goals", label: "Money Goals", description: "What you're saving for", span: "compact" },
  { id: "gettingStarted", label: "Getting Started", description: "Finish setting up Calico", span: "compact" },
  { id: "spending", label: "Spending", description: "This month vs. last month", span: "wide" },
  { id: "transactions", label: "Money Moves", description: "Your recent activity", span: "full" },
  { id: "recurring", label: "Repeating Payments", description: "Bills and subscriptions coming up", span: "compact" },
  { id: "investments", label: "Investments", description: "Your holdings and how they're doing", span: "compact" },
  { id: "advice", label: "What Calico Noticed", description: "Tips and suggestions just for you", span: "wide" },
];

const defaultVisibility = dashboardWidgets.reduce<Record<DashboardWidgetId, boolean>>((acc, widget) => {
  acc[widget.id] = true;
  return acc;
}, {} as Record<DashboardWidgetId, boolean>);

export const defaultDashboardPreferences: DashboardPreferences = {
  order: dashboardWidgets.map((widget) => widget.id),
  visibility: defaultVisibility,
  useLiveData: true,
};

export function widgetSpanClass(id: DashboardWidgetId): string {
  const widget = dashboardWidgets.find((item) => item.id === id);
  if (widget?.span === "wide") return "col-span-12 xl:col-span-6";
  if (widget?.span === "full") return "col-span-12";
  return "col-span-12 md:col-span-6 xl:col-span-3";
}

export function normalizeDashboardPreferences(value: unknown): DashboardPreferences {
  if (!value || typeof value !== "object") {
    return defaultDashboardPreferences;
  }

  const input = value as Partial<DashboardPreferences>;
  const allowedIds = new Set(dashboardWidgets.map((widget) => widget.id));
  const inputOrder = Array.isArray(input.order)
    ? input.order.filter((id): id is DashboardWidgetId => typeof id === "string" && allowedIds.has(id as DashboardWidgetId))
    : [];

  const mergedOrder = [
    ...inputOrder,
    ...dashboardWidgets.map((widget) => widget.id).filter((id) => !inputOrder.includes(id)),
  ];

  const inputVisibility = input.visibility && typeof input.visibility === "object"
    ? input.visibility
    : {};

  const mergedVisibility = dashboardWidgets.reduce<Record<DashboardWidgetId, boolean>>((acc, widget) => {
    const nextValue = (inputVisibility as Record<string, unknown>)[widget.id];
    acc[widget.id] = typeof nextValue === "boolean" ? nextValue : true;
    return acc;
  }, {} as Record<DashboardWidgetId, boolean>);

  return {
    order: mergedOrder,
    visibility: mergedVisibility,
    useLiveData: typeof input.useLiveData === "boolean" ? input.useLiveData : true,
  };
}
