'use client';

import { AppProvider } from '@/lib/store';
import { ChatInterface } from '@/components/ChatInterface';
import { WalletCard } from '@/components/WalletCard';
import { SettingsPanel } from '@/components/SettingsPanel';
import { TransactionHistory } from '@/components/TransactionHistory';

export default function Home() {
  return (
    <AppProvider>
      <div className="h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50 bg-gray-900/50 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-xs">
              AW
            </div>
            <div>
              <h1 className="font-semibold text-white text-sm leading-tight">Agent Wallet</h1>
              <p className="text-[10px] text-gray-500 leading-tight">OpenAI Reasoning + TinyFish Actions</p>
            </div>
          </div>
        </header>

        {/* Main layout: Chat + Sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Chat area */}
          <div className="flex-1 flex flex-col min-w-0">
            <ChatInterface />
          </div>

          {/* Right sidebar */}
          <aside className="w-80 border-l border-gray-800/50 bg-gray-900/30 overflow-y-auto p-4 space-y-4 flex-shrink-0 hidden md:block">
            <WalletCard />
            <SettingsPanel />
            <TransactionHistory />
          </aside>
        </div>
      </div>
    </AppProvider>
  );
}
