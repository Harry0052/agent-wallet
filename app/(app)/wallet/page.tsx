"use client";

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
    </div>
  );
}
