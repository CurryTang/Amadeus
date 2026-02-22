import '@radix-ui/themes/styles.css';
import './globals.css';

export const metadata = {
  title: 'Auto Reader',
  description: 'Research library, latest feed, and vibe researcher workspace',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
