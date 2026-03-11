import { RecoveryTable } from '@/components/refunds/recovery-table';
import { requirePageAuth } from '@/lib/server/authGuards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RefundCenterPage() {
  await requirePageAuth('/login');
  return (
    <div className="aw-shell aw-body min-h-screen px-4 py-6 md:px-7 md:py-8">
      <div className="mx-auto w-full max-w-[1500px]">
        <header className="mb-5 rounded-[22px] border border-[var(--aw-border)] bg-white/90 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="aw-kicker">Financial Recovery</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--aw-text)]">
                Refund Center
              </h1>
              <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                Resolve failed purchases directly from Agent Wallet with instant reversals, authorization voids, and refund tracking.
              </p>
            </div>
          </div>
        </header>

        <RecoveryTable />
      </div>
    </div>
  );
}
