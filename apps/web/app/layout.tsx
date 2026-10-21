import type { ReactNode } from 'react';
import { Tajawal } from 'next/font/google';
import '@dental/ui/tokens.css';
import './globals.css';

// self-hosted at build time by next/font: no request to Google from the visitor, no layout shift
// Tajawal has no 600: semibold text renders at 700, the nearest heavier weight
const tajawal = Tajawal({ subsets: ['arabic', 'latin'], weight: ['400', '500', '700'], display: 'swap', variable: '--font-tajawal' });

export const metadata = { title: 'منصة عيادات الأسنان', description: 'موقع إلكتروني ونظام إدارة لعيادات الأسنان' };
export const viewport = { themeColor: '#4f46e5' }; // clinic pages override this with their brand colour (generateViewport)

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <body>{children}</body>
    </html>
  );
}
