import type { ReactNode } from 'react';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import '@dental/ui/tokens.css';
import './globals.css';

// self-hosted at build time by next/font: no request to Google from the visitor, no layout shift
const plex = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-plex' });

export const metadata = { title: 'منصة عيادات الأسنان', description: 'موقع إلكتروني ونظام إدارة لعيادات الأسنان' };
export const viewport = { themeColor: '#4f46e5' }; // clinic pages override this with their brand colour (generateViewport)

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plex.variable}>
      <body>{children}</body>
    </html>
  );
}
