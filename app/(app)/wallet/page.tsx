"use client";

import { RecoveryTable } from "@/components/refunds/recovery-table";
import { WalletCard } from "@/components/WalletCard";
import { TransactionHistory } from "@/components/TransactionHistory";

export default function WalletPage() {

  return (
    <div className="aw-page">
      <div className="aw-page-header">
        <p className="aw-page-kicker">Wallet</p>
        <h1 className="aw-page-title">Wallet</h1>
        <p className="aw-page-subtitle">
          Balance, limits, funding, and ledger history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <WalletCard />
        <TransactionHistory alwaysShow />
      </div>

      <section className="mt-6">
        <div className="mb-3">
          <p className="aw-kicker">Financial Recovery</p>
          <h2 className="mt-1 text-[1.1rem] font-semibold text-[var(--aw-text)]">
            Refund Center
          </h2>
          <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
            Resolve failed purchases with reversals, refund requests, and live status tracking.
          </p>
        </div>
        <RecoveryTable />
      </section>
    </div>
  );
}
