'use client';

import { useEffect, useState } from 'react';
import { Activity, ShieldCheck, WalletCards } from 'lucide-react';
import { useApp } from '@/lib/store';
import { fmt } from '@/lib/utils';
import { ChatInterface } from '@/components/ChatInterface';
import { WalletCard } from '@/components/WalletCard';
import { SettingsPanel } from '@/components/SettingsPanel';
import { TransactionHistory } from '@/components/TransactionHistory';
import { AgentRail } from '@/components/AgentRail';
import { OpsDeck } from '@/components/OpsDeck';
import { StateSheet } from '@/components/StateSheet';
import { ProcurementPlanningPanel } from '@/components/ProcurementPlanningPanel';
import { SubscriptionOpsPanel } from '@/components/SubscriptionOpsPanel';

function getSystemStatusLabel(isProcessing: boolean, status: string | undefined): string {
  if (status === 'awaiting-approval') return 'Awaiting Approval';
  if (isProcessing) return 'Live Execution';
  if (status === 'completed') return 'Task Complete';
  if (status === 'cancelled') return 'Task Cancelled';
  return 'System Ready';
}

function getSystemStatusState(isProcessing: boolean, status: string | undefined): 'live' | 'ok' | 'alert' {
  if (status === 'cancelled') return 'alert';
  if (status === 'awaiting-approval' || isProcessing) return 'live';
  return 'ok';
}

export function AppShell() {
  const { wallet, activeTask, isProcessing } = useApp();
  const [isDemoMode, setIsDemoMode] = useState(false);

  const systemLabel = getSystemStatusLabel(isProcessing, activeTask?.status);
  const systemState = getSystemStatusState(isProcessing, activeTask?.status);

  useEffect(() => {
    const syncModeFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setIsDemoMode(params.get('demo') === '1');
    };

    syncModeFromUrl();
    window.addEventListener('popstate', syncModeFromUrl);

    return () => {
      window.removeEventListener('popstate', syncModeFromUrl);
    };
  }, []);

  const toggleDemoMode = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      params.delete('demo');
    } else {
      params.set('demo', '1');
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
    window.history.replaceState({}, '', nextUrl);
    setIsDemoMode((prev) => !prev);
  };

  return (
    <div className="aw-shell h-screen flex flex-col">
      <header className="shrink-0 px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-4">
        <div className="aw-surface-elevated px-4 py-3 md:px-6 md:py-4">
          <div className="flex flex-wrap items-center gap-4 md:gap-5 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-11 w-11 rounded-2xl border border-[rgba(201,165,106,0.5)] bg-[linear-gradient(145deg,rgba(201,165,106,0.24),rgba(201,165,106,0.06))] shadow-[0_10px_28px_rgba(201,165,106,0.25)] flex items-center justify-center">
                <span className="font-[var(--font-display)] text-lg tracking-[0.16em] text-[#f1dbb2]">AW</span>
              </div>
              <div className="min-w-0">
                <p className="font-[var(--font-display)] text-[1.22rem] leading-none tracking-[0.06em]">Agent Wallet</p>
                <p className="aw-kicker mt-1">Financial Operations Layer For AI Workers</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <span className="aw-status-chip" data-state={systemState}>
                <Activity size={12} className="opacity-85" />
                {systemLabel}
              </span>
              <button onClick={toggleDemoMode} className="aw-status-chip">
                {isDemoMode ? 'Exit Demo Mode' : 'Demo Mode'}
              </button>
              <span className="aw-status-chip">
                <ShieldCheck size={12} className="opacity-85" />
                Ledger Truth: Stripe + DB
              </span>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--aw-border)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-sm text-[var(--aw-text-soft)]">
                <WalletCards size={14} className="text-[var(--aw-text-muted)]" />
                <span className="aw-kicker !text-[0.6rem] !tracking-[0.14em]">Balance</span>
                <span className="font-semibold text-[var(--aw-text)]">{fmt(wallet.balance)}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 px-3 pb-3 md:px-6 md:pb-6">
        <div className={isDemoMode
          ? 'h-full grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_30rem] gap-4'
          : 'h-full grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_23rem] gap-4'}
        >
          <section className="min-h-0 flex flex-col gap-4">
            <div className={isDemoMode
              ? 'aw-surface-elevated min-h-[31rem] flex-1 overflow-hidden'
              : 'aw-surface-elevated min-h-[24rem] flex-1 overflow-hidden'}
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--aw-border)] px-4 py-3 md:px-5">
                <div>
                  <p className="aw-kicker">Command Panel</p>
                  <p className="text-sm text-[var(--aw-text-soft)]">
                    {isDemoMode
                      ? 'Demo flow: plan, research, policy checks, approval, and ledger outcome in one live view'
                      : 'Reasoning, live web execution, and purchase orchestration'}
                  </p>
                </div>
                <span className="aw-status-chip" data-state={isProcessing ? 'live' : 'ok'}>
                  {isProcessing ? 'Processing' : 'Standing By'}
                </span>
              </div>
              <div className="h-[calc(100%-76px)] md:h-[calc(100%-80px)] min-h-0">
                <ChatInterface />
              </div>
            </div>

            <ProcurementPlanningPanel />
            <SubscriptionOpsPanel />

            <OpsDeck demoMode={isDemoMode} />

            <div className="xl:hidden grid gap-4 pb-1">
              <WalletCard />
              <AgentRail demoMode={isDemoMode} />
              {!isDemoMode && <SettingsPanel />}
              {!isDemoMode && <TransactionHistory />}
            </div>
          </section>

          <aside className="hidden xl:flex min-h-0 flex-col gap-4">
            {isDemoMode ? (
              <>
                <AgentRail demoMode />
                <WalletCard />
              </>
            ) : (
              <>
                <WalletCard />
                <AgentRail />
              </>
            )}
            <div className="aw-scroll min-h-0 overflow-y-auto space-y-4 pr-1">
              <SettingsPanel />
              <TransactionHistory />
            </div>
          </aside>
        </div>
      </main>

      <StateSheet />
    </div>
  );
}
