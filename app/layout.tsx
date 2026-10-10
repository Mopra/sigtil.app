import type { Metadata, Viewport } from 'next';
import { Figtree } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { daDK } from '@clerk/localizations';
import './globals.css';

const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap' });

export const metadata: Metadata = {
  title: 'sigtil',
  description: 'Din hjemmeside. Sig til, så ændrer vi den.',
};

export const viewport: Viewport = {
  themeColor: '#eef0ed',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className={figtree.variable}>
      <body className="font-sans antialiased">
        <ClerkProvider
          localization={daDK}
          appearance={{
            variables: {
              colorPrimary: '#2e6b52',
              colorBackground: '#ffffff',
              borderRadius: '0.875rem',
              fontFamily: 'var(--font-figtree), system-ui, sans-serif',
              fontSize: '0.95rem',
            },
            elements: {
              cardBox: 'shadow-window border border-line rounded-panel',
              formButtonPrimary: 'shadow-none',
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
