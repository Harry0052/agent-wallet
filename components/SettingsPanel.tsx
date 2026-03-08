'use client';

import { useMemo, useState } from 'react';
import { useApp } from '@/lib/store';

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function listToText(items: string[]): string {
  return items.join(', ');
}

export function SettingsPanel() {
  const { wallet, updateSettings, addRecipient, showSettings, toggleSettings } = useApp();
  const s = wallet.settings;
  const [recipientName, setRecipientName] = useState('');
  const [recipientAccount, setRecipientAccount] = useState('');

  const allowedText = useMemo(() => listToText(s.allowedMerchants), [s.allowedMerchants]);
  const blockedText = useMemo(() => listToText(s.blockedMerchants), [s.blockedMerchants]);

  if (!showSettings) return null;

  const submitRecipient = async () => {
    const name = recipientName.trim();
    const account = recipientAccount.trim();
    if (!name || !account) return;
    await addRecipient(name, account);
    setRecipientName('');
    setRecipientAccount('');
  };

  return (
    <div className="bg-gray-800/90 border border-gray-700/50 rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white text-sm">Guardrails</h3>
        <button onClick={toggleSettings} className="text-gray-400 hover:text-white text-sm transition-colors">
          Close
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Max Transaction</label>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm">$</span>
          <input
            type="number"
            min={1}
            value={s.maxTransaction}
            onChange={(e) => updateSettings({ maxTransaction: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Daily Limit</label>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm">$</span>
          <input
            type="number"
            min={1}
            value={s.dailyLimit}
            onChange={(e) => updateSettings({ dailyLimit: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Monthly Budget</label>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm">$</span>
          <input
            type="number"
            min={1}
            value={s.monthlyBudget}
            onChange={(e) => updateSettings({ monthlyBudget: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Approval Threshold</label>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm">$</span>
          <input
            type="number"
            min={1}
            value={s.approvalThreshold}
            onChange={(e) => updateSettings({ approvalThreshold: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <p className="text-[10px] text-gray-500">Purchases at or above this amount require manual approval.</p>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Allowed Merchants (comma-separated)</label>
        <input
          type="text"
          value={allowedText}
          onChange={(e) => updateSettings({ allowedMerchants: parseList(e.target.value) })}
          placeholder="Starbucks, Peet's"
          className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-blue-500 focus:outline-none"
        />
        <p className="text-[10px] text-gray-500">Leave empty to allow all merchants except blocked ones.</p>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Blocked Merchants (comma-separated)</label>
        <input
          type="text"
          value={blockedText}
          onChange={(e) => updateSettings({ blockedMerchants: parseList(e.target.value) })}
          placeholder="Doordash, Uber Eats"
          className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <label className="text-xs text-gray-400">Require location for local search</label>
        <button
          onClick={() => updateSettings({ requireLocation: !s.requireLocation })}
          className={`w-10 h-5 rounded-full transition-colors relative ${s.requireLocation ? 'bg-green-600' : 'bg-gray-600'}`}
        >
          <div
            className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${s.requireLocation ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
      </div>

      <div className="pt-2 border-t border-gray-700/50 space-y-2">
        <label className="text-xs text-gray-400">Approved Recipients (Stripe Connect `acct_...`)</label>
        <div className="space-y-1.5 max-h-24 overflow-y-auto">
          {wallet.recipients.length === 0 ? (
            <p className="text-[11px] text-gray-500">No approved recipients yet.</p>
          ) : wallet.recipients.map((recipient) => (
            <div key={recipient.id} className="text-[11px] text-gray-300 flex items-center justify-between gap-2">
              <span className="truncate">{recipient.name}</span>
              <span className="text-gray-500">{recipient.status}</span>
            </div>
          ))}
        </div>

        <input
          type="text"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          placeholder="Recipient name"
          className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-blue-500 focus:outline-none"
        />
        <input
          type="text"
          value={recipientAccount}
          onChange={(e) => setRecipientAccount(e.target.value)}
          placeholder="acct_..."
          className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={() => { void submitRecipient(); }}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-medium text-white transition-colors"
        >
          Add Approved Recipient
        </button>
      </div>
    </div>
  );
}
