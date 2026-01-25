import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' });

export const metadata: Metadata = {
  title: 'Magazyn Przemiałów',
  description: 'Panel rozliczeń przemiałów na halach produkcyjnych'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className="dark">
      <body className={`${spaceGrotesk.variable} bg-bg text-body antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
