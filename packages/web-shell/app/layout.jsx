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
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
