'use client';

import { useState } from 'react';
import { CreditCard, History, Settings2 } from 'lucide-react';
import { useApp } from '@/lib/store';
import { fmt } from '@/lib/utils';
import { getDailySpent, getMonthlySpent } from '@/services/wallet';

export function WalletCard() {
  const { wallet, addFunds, toggleSettings, toggleHistory } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [amount, setAmount] = useState('');

  const handleAdd = () => {
    const value = parseFloat(amount);
    if (value > 0) {
      addFunds(value);
      setAmount('');
      setShowAdd(false);
    }
  };

  const dailySpent = getDailySpent(wallet);
  const monthlySpent = getMonthlySpent(wallet);
  const usagePct = wallet.settings.monthlyBudget > 0
    ? Math.min((monthlySpent / wallet.settings.monthlyBudget) * 100, 100)
    : 0;

  return (
    <section className="aw-surface p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="aw-kicker">Wallet Core</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-[var(--aw-text)]">{fmt(wallet.balance)}</p>
        </div>
        <span className="aw-status-chip" data-state={wallet.balance > 0 ? 'ok' : 'alert'}>
          {wallet.balance > 0 ? 'Funded' : 'Needs Funds'}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--aw-text-soft)]">
          <span>Monthly spend</span>
          <span>{fmt(monthlySpent)} / {fmt(wallet.settings.monthlyBudget)}</span>
        </div>
        <div className="aw-progress">
          <span style={{ width: `${usagePct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-[var(--aw-border)] bg-black/15 px-3 py-2.5">
          <p className="text-[var(--aw-text-muted)]">Max transaction</p>
          <p className="mt-1 text-sm font-semibold text-[var(--aw-text)]">{fmt(wallet.settings.maxTransaction)}</p>
        </div>
        <div className="rounded-xl border border-[var(--aw-border)] bg-black/15 px-3 py-2.5">
          <p className="text-[var(--aw-text-muted)]">Daily limit</p>
          <p className="mt-1 text-sm font-semibold text-[var(--aw-text)]">{fmt(dailySpent)} / {fmt(wallet.settings.dailyLimit)}</p>
        </div>
      </div>

      {showAdd ? (
        <div className="space-y-2">
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Top-up amount"
            className="aw-input h-10 text-sm"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleAdd} className="aw-button-primary h-10 text-sm">Continue</button>
            <button onClick={() => setShowAdd(false)} className="aw-button-secondary h-10 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="aw-button-ghost h-10 text-xs"
          >
            <span className="inline-flex items-center gap-1">
              <CreditCard size={12} />
              Fund
            </span>
          </button>
          <button
            onClick={toggleHistory}
            className="aw-button-secondary h-10 text-xs"
          >
            <span className="inline-flex items-center gap-1">
              <History size={12} />
              Ledger
            </span>
          </button>
          <button
            onClick={toggleSettings}
            className="aw-button-secondary h-10 text-xs"
          >
            <span className="inline-flex items-center gap-1">
              <Settings2 size={12} />
              Guardrails
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
