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
    // P7: dir/lang are client-managed (UiPrefsBar); server ships the Iran default.
    // suppressHydrationWarning because the client flips dir/lang on boot.
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
