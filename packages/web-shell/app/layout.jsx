import './globals.css';
import { Inter } from 'next/font/google';

// Inter (variable) is the single UI face for the whole web-shell — the
// "Working Table" design system (unspirit import, 2026-07-12): compact,
// highly legible, hierarchy by weight (450 body / 550 labels), no display
// serif. Replaces Instrument Sans/Serif. Variable axis covers the in-between
// weights the system leans on. Classname exposed as a CSS var so CSS can
// reference it without ESM imports.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap'
});

export const metadata = {
  title: 'Uncraft',
  description: 'Design without borders.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  // suppressHydrationWarning silences the React 18 mismatch warning
  // when browser extensions (Grammarly, Demoway, dark-reader, etc.)
  // inject attributes onto <html>/<body> before hydration. Without it,
  // the dev overlay fires every page-load on machines with these
  // extensions installed. It does NOT suppress real React errors —
  // only the attribute-mismatch hydration warning.
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
