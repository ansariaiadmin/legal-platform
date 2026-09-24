import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'مشاوره حقوقی آنلاین',
  description: 'نوبت مشاوره بگیر، صف را زنده ببین، با AIِ وکیل مشورت کن.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'مشاور حقوقی' },
};

export const viewport: Viewport = {
  themeColor: '#f4c85d',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
