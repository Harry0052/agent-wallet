import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DM_Sans } from 'next/font/google';
import './globals.css';

const bodyFont = DM_Sans({
  subsets: ['latin'],
  variable: '--font-calico',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Calico',
  description:
    'Calico — the friendly money app that helps you understand your spending, spot recurring bills, and feel more in control.',
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
