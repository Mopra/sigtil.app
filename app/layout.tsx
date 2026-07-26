import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { daDK } from '@clerk/localizations';
import './globals.css';

export const metadata: Metadata = {
  title: 'sigtil',
  description: 'Din hjemmeside. Sig til, så ændrer vi den.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="font-sans antialiased">
        <ClerkProvider localization={daDK}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
