import type { DashboardPreferences, DashboardWidgetDefinition, DashboardWidgetId } from "@/components/dashboard/dashboardTypes";

export const DASHBOARD_STORAGE_KEY = "calico.custom-dashboard.v1";

export const dashboardWidgets: DashboardWidgetDefinition[] = [
  { id: "netWorth", label: "Net Worth", description: "Your total balance across all accounts", span: "wide" },
  { id: "spending", label: "Spending", description: "This month compared to last month", span: "wide" },
  { id: "okayToSpend", label: "Safe to Spend", description: "What you have left after bills", span: "compact" },
  { id: "recurring", label: "Upcoming Bills", description: "Bills and subscriptions due soon", span: "compact" },
  { id: "budget", label: "Spending Plan", description: "How your spending compares to your plan", span: "compact" },
  { id: "transactions", label: "Recent Activity", description: "Your latest transactions", span: "full" },
  { id: "gettingStarted", label: "Getting Started", description: "Finish setting up Calico", span: "compact" },
  { id: "goals", label: "Money Goals", description: "What you're saving for", span: "compact" },
  { id: "advice", label: "Tips from Calico", description: "Helpful suggestions based on your activity", span: "wide" },
  { id: "investments", label: "Investments", description: "Your holdings and performance", span: "compact" },
  { id: "creditScore", label: "Credit Score", description: "Your credit score at a glance", span: "compact" },
];

const defaultVisibility = dashboardWidgets.reduce<Record<DashboardWidgetId, boolean>>((acc, widget) => {
  acc[widget.id] = [
    "netWorth",
    "spending",
    "okayToSpend",
    "recurring",
    "budget",
    "transactions",
    "advice",
  ].includes(widget.id);
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
    acc[widget.id] = typeof nextValue === "boolean" ? nextValue : defaultVisibility[widget.id];
    return acc;
  }, {} as Record<DashboardWidgetId, boolean>);

  return {
    order: mergedOrder,
    visibility: mergedVisibility,
    useLiveData: typeof input.useLiveData === "boolean" ? input.useLiveData : true,
  };
}
