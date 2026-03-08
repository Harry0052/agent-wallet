'use client';

import { useState } from 'react';
import { useApp } from '@/lib/store';
import { fmt } from '@/lib/utils';
import { getDailySpent, getMonthlySpent } from '@/services/wallet';

export function WalletCard() {
  const { wallet, addFunds, toggleSettings, toggleHistory } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [amount, setAmount] = useState('');

  const handleAdd = () => {
    const val = parseFloat(amount);
    if (val > 0) {
      addFunds(val);
      setAmount('');
      setShowAdd(false);
    }
  };

  const dailySpent = getDailySpent(wallet);
  const monthlySpent = getMonthlySpent(wallet);
  const pct = wallet.settings.monthlyBudget > 0
    ? Math.min((monthlySpent / wallet.settings.monthlyBudget) * 100, 100)
    : 0;

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700/50 rounded-2xl p-5 space-y-4">
      {/* Balance */}
      <div className="text-center space-y-1">
        <p className="text-xs uppercase tracking-wider text-gray-400">Wallet Balance</p>
        <p className="text-4xl font-bold text-white">{fmt(wallet.balance)}</p>
      </div>

      {/* Monthly budget bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Monthly spend</span>
          <span>{fmt(monthlySpent)} / {fmt(wallet.settings.monthlyBudget)}</span>
        </div>
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e',
            }}
          />
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-gray-700/30 rounded-lg py-2">
          <p className="text-xs text-gray-400">Max tx</p>
          <p className="text-sm font-semibold text-white">{fmt(wallet.settings.maxTransaction)}</p>
        </div>
        <div className="bg-gray-700/30 rounded-lg py-2">
          <p className="text-xs text-gray-400">Daily limit</p>
          <p className="text-sm font-semibold text-white">{fmt(dailySpent)} / {fmt(wallet.settings.dailyLimit)}</p>
        </div>
      </div>

      {/* Add funds */}
      {showAdd ? (
        <div className="flex gap-2">
          <input
            type="number"
            min="1"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
            autoFocus
          />
          <button onClick={handleAdd} className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium text-white transition-colors">
            Add
          </button>
          <button onClick={() => setShowAdd(false)} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="flex-1 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-600/50 rounded-lg text-sm font-medium text-green-300 transition-colors"
          >
            + Fund (Stripe)
          </button>
          <button
            onClick={toggleHistory}
            className="flex-1 py-2 bg-gray-700/50 hover:bg-gray-700 border border-gray-600/50 rounded-lg text-sm text-gray-300 transition-colors"
          >
            History
          </button>
          <button
            onClick={toggleSettings}
            className="py-2 px-3 bg-gray-700/50 hover:bg-gray-700 border border-gray-600/50 rounded-lg text-sm text-gray-300 transition-colors"
          >
            Settings
          </button>
        </div>
      )}
    </div>
  );
}
