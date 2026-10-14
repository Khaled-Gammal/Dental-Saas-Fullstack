import type { ReactNode } from 'react';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import '@dental/ui/tokens.css';
import './globals.css';

// self-hosted at build time by next/font: no request to Google from the visitor, no layout shift
const plex = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-plex' });

export const metadata = { title: 'Dental SaaS', description: 'Websites and clinic management for dental clinics' };
export const viewport = { themeColor: '#0f2f5c' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plex.variable}>
      <body>{children}</body>
    </html>
  );
}
