import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';

const bodyFont = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Agent Wallet',
  description:
    'Financial OS for tasks, wallet controls, and live web execution powered by TinyFish.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} aw-body antialiased min-h-screen overflow-x-hidden`}>
        {children}
      </body>
    </html>
  );
}
