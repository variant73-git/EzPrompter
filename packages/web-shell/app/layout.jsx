import './globals.css';

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
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
