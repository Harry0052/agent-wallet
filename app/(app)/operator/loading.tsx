export default function OperatorLoading() {
  return (
    <div className="aw-page">
      <section className="aw-entry-bridge" data-entry="loading">
        <div className="h-3 w-28 animate-pulse rounded-full bg-[var(--aw-surface-emphasis)]" />
        <div className="mt-3 h-8 w-full max-w-xl animate-pulse rounded-xl bg-[var(--aw-surface-emphasis)]" />
        <div className="mt-2 h-4 w-full max-w-2xl animate-pulse rounded-md bg-[var(--aw-surface-emphasis)]" />
      </section>

      <div className="aw-page-header mt-6">
        <div className="h-3 w-24 animate-pulse rounded-full bg-[var(--aw-surface-emphasis)]" />
        <div className="mt-3 h-8 w-64 animate-pulse rounded-xl bg-[var(--aw-surface-emphasis)]" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="aw-surface-elevated min-h-[32rem] animate-pulse" />
        <div className="aw-surface min-h-[24rem] animate-pulse" />
      </div>
    </div>
  );
}
