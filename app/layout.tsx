import './globals.css'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { StartTimeProvider } from '@/components/StartTimeContext'

export const metadata: Metadata = {
  title: 'Indie Cinemas London',
  description: 'Indie cinema listings in London',
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || 'https://indiecinemas.london'),
  openGraph: {
    title: 'Indie Cinemas London',
    description: 'Indie cinema listings in London',
    url: '/',
    siteName: 'Indie Cinemas London',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Indie Cinemas London',
    description: 'Indie cinema listings in London',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Dark status bar / address bar on mobile for smoother feel
  themeColor: '#000000',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-7NN225RZFN"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-7NN225RZFN');
          `}
        </Script>
        <header className="border-b border-white border-t-0 border-l-0 border-r-0 bg-black/85 text-white sticky top-0 z-50 backdrop-blur-sm">
          <div className="container py-4 flex items-center justify-between">
            <a
              href="/"
              className="text-xl font-medium"
              style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
            >Indie Cinemas London</a>
            <a
              href="mailto:hello@indiecinemas.london"
              aria-label="Email hello@indiecinemas.london"
              title="Email hello@indiecinemas.london"
              className="group text-white/90 hover:text-white transition-colors"
            >
              {/* Thinner outline envelope icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="butt"
                strokeLinejoin="miter"
                className="w-6 h-6 text-white group-hover:text-[rgb(var(--hover))] transition-colors"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </a>
          </div>
        </header>
        <StartTimeProvider>
          <main className="container py-6">{children}</main>
        </StartTimeProvider>
        <footer className="border-t">
          <div className="container py-6 text-sm text-gray-500">Built with Next.js</div>
        </footer>
      </body>
    </html>
  )
}
