import { ReconciliationTable } from "@/components/reconciliation-table";
import { getReconciliationData } from "@/lib/dashboard/getReconciliationData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReconciliationDashboardPage() {
  const data = await getReconciliationData({ limit: 250 });

  return (
    <div className="aw-shell aw-body min-h-screen px-4 py-6 md:px-7 md:py-8">
      <div className="mx-auto w-full max-w-[1500px]">
        <header className="mb-5 rounded-[22px] border border-[var(--aw-border)] bg-white/90 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="aw-kicker">Financial OS</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--aw-text)]">
                Reconciliation Dashboard
              </h1>
              <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                Every autonomous purchase with financial status, activation status, blockers, evidence freshness, and recommended actions.
              </p>
            </div>
            <p className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-1 text-xs text-[var(--aw-text-muted)]">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </p>
          </div>
        </header>

        <ReconciliationTable data={data} />
      </div>
    </div>
  );
}
