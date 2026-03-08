import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Wallet',
  description: 'The spending layer for AI agents. Chat-first autonomous purchasing powered by TinyFish.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased h-screen overflow-hidden">
        {children}
      </body>
    </html>
  );
}
