import type { Metadata } from 'next';
import { Providers } from './providers';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Click-Deploy — Self-Hosted PaaS',
  description: 'Deploy and manage containerized applications across distributed infrastructure. Open-source, self-hosted Platform as a Service.',
  keywords: ['PaaS', 'Docker', 'Swarm', 'deployment', 'self-hosted', 'containers'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
