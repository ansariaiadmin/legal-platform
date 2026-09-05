import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'پلتفرم حقوقی — دفتر هوشمند',
  description: 'Practice Management for Lawyers — جامعه‌ای از کارشناس‌های هوشمند',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
