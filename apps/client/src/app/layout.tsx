import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'مشاورهٔ حقوقی آنلاین',
  description: 'نوبت مشاورهٔ حقوقی بگیرید، جایگاه خود در صف را ببینید و از کیف پول پرداخت کنید.',
  manifest: '/portal/manifest.webmanifest',
  icons: { icon: '/portal/icon.svg' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'مشاورهٔ حقوقی' },
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
      <body>{children}</body>
    </html>
  );
}
