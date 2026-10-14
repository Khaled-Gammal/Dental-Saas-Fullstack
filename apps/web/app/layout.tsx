import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Dental SaaS', description: 'Websites and clinic management for dental clinics' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
