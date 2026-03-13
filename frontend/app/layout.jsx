import '@radix-ui/themes/styles.css';
import './globals.css';

export const metadata = {
  title: 'Auto Reader',
  description: 'Research library, tracker, paper notes, and saving tools',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
