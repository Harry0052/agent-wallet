import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Wallet',
  description:
    'Agent Wallet — the friendly money app that helps you understand your spending, spot recurring bills, and feel more in control.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="aw-body antialiased min-h-screen overflow-x-hidden bg-[var(--aw-bg)] text-[var(--aw-text)]">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
