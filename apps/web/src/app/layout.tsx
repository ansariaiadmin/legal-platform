import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Legal Platform',
  description: 'Practice Management for Lawyers',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
