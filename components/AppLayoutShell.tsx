"use client";

import { Suspense } from 'react';
import { AppProvider } from '@/lib/store';
import { AppNav } from '@/components/AppNav';

export function AppLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <div className="sw-shell">
        <Suspense fallback={null}>
          <AppNav />
        </Suspense>
        <div className="sw-content">
          {children}
        </div>
      </div>
    </AppProvider>
  );
}
