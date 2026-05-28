import './globals.css';
import { Instrument_Sans, Instrument_Serif } from 'next/font/google';

// Instrument family — used by canvas-side popups/modals/menus so the
// surface visually matches the Uncraft browser extension widget
// (which is the source-of-truth for the design language). Aeonik
// stays as the default body font for nodes / dock / toolbars; only
// the popup family adopts Instrument. Both subsets preloaded;
// classnames exposed as CSS vars so popup CSS can reference them
// without ESM imports.
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument-sans',
  display: 'swap'
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
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
    <html lang="en" suppressHydrationWarning className={`${instrumentSans.variable} ${instrumentSerif.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
