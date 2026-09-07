import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' });

const themeBootScript = `(function(){try{var remember=localStorage.getItem('apka-ui:remember')!=='0';var storage=remember?localStorage:sessionStorage;var raw=storage.getItem('apka-ui')||localStorage.getItem('apka-ui')||sessionStorage.getItem('apka-ui');var saved=raw?JSON.parse(raw):null;var theme=saved&&saved.state&&saved.state.theme==='light'?'light':'dark';var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(theme);root.dataset.theme=theme;root.style.colorScheme=theme;}catch(error){}})();`;

export const metadata: Metadata = {
  title: 'Panel Produkcja',
  description: 'Panel rozlicze艅 przemia艂贸w na halach produkcyjnych'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className={`${spaceGrotesk.variable} bg-bg text-body antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

