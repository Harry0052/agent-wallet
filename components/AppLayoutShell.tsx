"use client";

import { Suspense } from 'react';
import { AppProvider } from '@/lib/store';
import { AppNav } from '@/components/AppNav';
import { StateSheet } from '@/components/StateSheet';

function NavFallback() {
  return (
    <div className="aw-global-nav hidden md:block" data-surface="light">
      <div className="aw-global-nav-inner max-w-[1280px] px-5">
        <div className="h-8 w-8 rounded-lg bg-[var(--aw-primary-soft)]" />
        <div className="h-5 w-28 rounded-md bg-[var(--aw-surface-subtle)]" />
      </div>
    </div>
  );
}

export function AppLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Suspense fallback={<NavFallback />}>
        <AppNav />
      </Suspense>

      <main className="min-h-screen pt-0 pb-20 md:pt-[3.6rem] md:pb-8">
        {children}
      </main>

      <StateSheet />
    </AppProvider>
  );
}
