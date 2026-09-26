import type { Metadata } from 'next';
import '@fontsource-variable/vazirmatn';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'پلتفرم حقوقی',
  description: 'دفتر کار هوشمند وکیل — Smart practice workspace for lawyers',
  applicationName: 'پلتفرم حقوقی',
  authors: [{ name: 'Mohammad Ansari', url: 'https://ansariai.ir' }],
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // dir/lang are applied on the client (UiPrefsBar); the server renders the
    // Persian default, hence suppressHydrationWarning.
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
