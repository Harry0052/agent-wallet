'use client';

import { useApp } from '@/lib/store';
import { fmt, fmtFull } from '@/lib/utils';

export function TransactionHistory() {
  const { wallet, showHistory, toggleHistory } = useApp();

  if (!showHistory) return null;

  const txns = wallet.transactions;

  return (
    <div className="bg-gray-800/90 border border-gray-700/50 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white text-sm">Transaction History</h3>
        <button onClick={toggleHistory} className="text-gray-400 hover:text-white text-sm transition-colors">
          Close
        </button>
      </div>

      {txns.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4">No transactions yet</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {txns.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-700/30 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{tx.description}</p>
                <p className="text-[10px] text-gray-500">
                  {fmtFull(tx.createdAt)}
                  {tx.source ? ` • ${tx.source}` : ''}
                </p>
              </div>
              <div className="text-right ml-3">
                <p className={`text-sm font-semibold ${tx.direction === 'credit' ? 'text-green-400' : 'text-white'}`}>
                  {tx.direction === 'credit' ? '+' : '-'}{fmt(tx.amount)}
                </p>
                <p className={`text-[10px] ${tx.status === 'succeeded' ? 'text-gray-500' : 'text-yellow-400'}`}>
                  {tx.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
