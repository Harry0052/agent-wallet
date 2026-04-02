"use client";

import {
  Skeleton,
  SkeletonCard,
  SkeletonChart,
  SkeletonStatCard,
  SkeletonTable,
  SkeletonText,
} from "./Skeleton";

/* ── Dashboard / Home skeleton ── */

export function HomeSkeleton() {
  return (
    <div className="aw-workspace-page" aria-hidden>
      {/* Greeting */}
      <div style={{ marginBottom: 28 }}>
        <Skeleton width="25%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 8 }} />
        <Skeleton width="40%" height={14} />
      </div>
      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Chart + sidebar */}
      <div className="aw-workspace-grid" data-columns="2-1" style={{ marginBottom: 24 }}>
        <SkeletonChart height={260} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
      {/* Transaction list preview */}
      <SkeletonTable rows={4} columns={4} />
    </div>
  );
}

/* ── Accounts skeleton ── */

export function AccountsSkeleton() {
  return (
    <div className="aw-workspace-page" aria-hidden>
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="20%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
        <Skeleton width="45%" height={13} />
      </div>
      {/* Net worth chart */}
      <SkeletonChart height={220} className="mb-5" />
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Account list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="aw-card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Skeleton circle width={40} height={40} />
            <div style={{ flex: 1 }}>
              <Skeleton width="50%" height={14} style={{ marginBottom: 6 }} />
              <Skeleton width="30%" height={11} />
            </div>
            <Skeleton width={80} height={18} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Transactions skeleton ── */

export function TransactionsSkeleton() {
  return (
    <div className="aw-workspace-page" aria-hidden>
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="22%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
        <Skeleton width="55%" height={13} />
      </div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} width={70} height={34} borderRadius="var(--aw-radius-pill)" />
        ))}
      </div>
      {/* Money intelligence cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-xl border border-[var(--aw-border)] bg-white px-3 py-2.5">
            <Skeleton width="65%" height={9} style={{ marginBottom: 10 }} />
            <Skeleton width="40%" height={20} style={{ marginBottom: 8 }} />
            <Skeleton width="80%" height={9} />
          </div>
        ))}
      </div>
      {/* Transaction table */}
      <TransactionTableSkeleton />
    </div>
  );
}

/* ── Transaction table (reused in Transactions + Statements) ── */

export function TransactionTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="aw-card-table" aria-hidden>
      <div className="grid grid-cols-[minmax(0,1.2fr)_180px_120px_130px] gap-4 border-b border-[var(--aw-border)] px-4 py-3">
        <Skeleton width="60%" height={10} />
        <Skeleton width="50%" height={10} />
        <Skeleton width="40%" height={10} style={{ marginLeft: "auto" }} />
        <Skeleton width="45%" height={10} style={{ marginLeft: "auto" }} />
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="grid grid-cols-[minmax(0,1.2fr)_180px_120px_130px] gap-4 px-4 py-4"
          style={{ borderTop: row > 0 ? "1px solid var(--aw-border)" : undefined }}
        >
          <div>
            <Skeleton width={`${55 + Math.random() * 25}%`} height={14} style={{ marginBottom: 6 }} />
            <Skeleton width={`${35 + Math.random() * 20}%`} height={10} />
          </div>
          <Skeleton width="60%" height={13} style={{ alignSelf: "center" }} />
          <Skeleton width="55%" height={13} style={{ alignSelf: "center", marginLeft: "auto" }} />
          <Skeleton width="45%" height={14} style={{ alignSelf: "center", marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}

/* ── Budgets skeleton ── */

export function BudgetsSkeleton() {
  return (
    <div className="aw-workspace-page" aria-hidden>
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="30%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
        <Skeleton width="55%" height={13} />
      </div>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Budget rows */}
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="aw-card"
          style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 16 }}
        >
          <div style={{ flex: 1 }}>
            <Skeleton width={`${40 + Math.random() * 20}%`} height={14} style={{ marginBottom: 8 }} />
            <Skeleton width="100%" height={7} borderRadius={999} />
          </div>
          <Skeleton width={70} height={16} />
        </div>
      ))}
    </div>
  );
}

/* ── Goals skeleton ── */

export function GoalsSkeleton() {
  return (
    <div className="aw-page" aria-hidden>
      <div className="px-4 py-6">
        <div style={{ marginBottom: 24 }}>
          <Skeleton width="22%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
          <Skeleton width="60%" height={13} />
        </div>
        {/* Goal cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="aw-card">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <Skeleton circle width={36} height={36} />
                <div style={{ flex: 1 }}>
                  <Skeleton width="60%" height={14} style={{ marginBottom: 6 }} />
                  <Skeleton width="35%" height={10} />
                </div>
              </div>
              <Skeleton width="100%" height={7} borderRadius={999} style={{ marginBottom: 10 }} />
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Skeleton width="30%" height={11} />
                <Skeleton width="25%" height={11} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Insights skeleton ── */

export function InsightsSkeleton() {
  return (
    <div aria-hidden style={{ display: "flex", justifyContent: "center", paddingTop: 60, paddingBottom: 60 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="aw-card">
            <Skeleton width="55%" height={14} style={{ marginBottom: 10 }} />
            <SkeletonText lines={2} lineHeight={11} gap={8} lastLineWidth="80%" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Cash Flow skeleton ── */

export function CashFlowSkeleton() {
  return (
    <div className="aw-workspace-page" aria-hidden>
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="20%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
        <Skeleton width="50%" height={13} />
      </div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Sankey / chart area */}
      <SkeletonChart height={300} />
      {/* Entries */}
      <div style={{ marginTop: 20 }}>
        <SkeletonTable rows={5} columns={4} />
      </div>
    </div>
  );
}

/* ── Reports skeleton ── */

export function ReportsSkeleton() {
  return (
    <div className="aw-workspace-page" aria-hidden>
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="18%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
        <Skeleton width="50%" height={13} />
      </div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Charts */}
      <div className="aw-workspace-grid" data-columns="2" style={{ marginBottom: 24 }}>
        <SkeletonChart height={200} />
        <SkeletonChart height={200} />
      </div>
      {/* Category breakdown */}
      <SkeletonTable rows={6} columns={3} />
    </div>
  );
}

/* ── Investments skeleton ── */

export function InvestmentsSkeleton() {
  return (
    <div className="aw-workspace-page" aria-hidden>
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="22%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
        <Skeleton width="55%" height={13} />
      </div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Holdings */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="aw-card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Skeleton width={40} height={40} borderRadius="var(--aw-radius-md)" />
            <div style={{ flex: 1 }}>
              <Skeleton width="45%" height={14} style={{ marginBottom: 6 }} />
              <Skeleton width="25%" height={11} />
            </div>
            <div style={{ textAlign: "right" }}>
              <Skeleton width={70} height={14} style={{ marginBottom: 6, marginLeft: "auto" }} />
              <Skeleton width={50} height={11} style={{ marginLeft: "auto" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Subscriptions / Recurring skeleton ── */

export function SubscriptionsSkeleton() {
  return (
    <div className="aw-workspace-page" aria-hidden>
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="20%" height={28} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 10 }} />
        <Skeleton width="40%" height={13} />
      </div>
      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Subscription rows */}
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="aw-card"
          style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 14 }}
        >
          <Skeleton circle width={36} height={36} />
          <div style={{ flex: 1 }}>
            <Skeleton width={`${40 + Math.random() * 25}%`} height={14} style={{ marginBottom: 6 }} />
            <Skeleton width="35%" height={10} />
          </div>
          <Skeleton width={65} height={16} />
        </div>
      ))}
    </div>
  );
}

/* ── Connect workspace skeleton ── */

export function ConnectSkeleton() {
  return (
    <div aria-hidden style={{ display: "flex", justifyContent: "center", paddingTop: 60, paddingBottom: 60 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="aw-card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Skeleton circle width={44} height={44} />
            <div style={{ flex: 1 }}>
              <Skeleton width="50%" height={14} style={{ marginBottom: 6 }} />
              <Skeleton width="35%" height={11} />
            </div>
            <Skeleton width={24} height={24} borderRadius="var(--aw-radius-md)" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Task Center skeleton ── */

export function TaskCenterSkeleton() {
  return (
    <div aria-hidden style={{ display: "flex", justifyContent: "center", paddingTop: 60, paddingBottom: 60 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-[var(--aw-border)] bg-white px-5 py-4">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Skeleton circle width={28} height={28} />
              <Skeleton width="45%" height={14} />
            </div>
            <SkeletonText lines={2} lineHeight={11} gap={8} lastLineWidth="65%" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Control Center skeleton ── */

export function ControlCenterSkeleton() {
  return (
    <div aria-hidden style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SkeletonCard />
          <SkeletonChart height={180} />
        </div>
      </div>
    </div>
  );
}

/* ── Statements skeleton (inline sections) ── */

export function StatementsInlineSkeleton() {
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Skeleton width="30%" height={16} style={{ marginBottom: 4 }} />
      <Skeleton width="50%" height={22} borderRadius="var(--aw-radius-md)" style={{ marginBottom: 8 }} />
      <SkeletonText lines={2} lineHeight={11} gap={8} lastLineWidth="75%" />
    </div>
  );
}

export function StatementsRecurringSkeleton() {
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i > 0 ? "1px solid var(--aw-border)" : undefined }}>
          <Skeleton circle width={32} height={32} />
          <div style={{ flex: 1 }}>
            <Skeleton width={`${40 + Math.random() * 25}%`} height={13} style={{ marginBottom: 6 }} />
            <Skeleton width="30%" height={10} />
          </div>
          <Skeleton width={55} height={14} />
        </div>
      ))}
    </div>
  );
}
