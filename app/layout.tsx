import './globals.css'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'

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
              {/* Replaced envelope icon with provided SVG; ensure stroke renders white */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                strokeWidth="0.21"
                vectorEffect="non-scaling-stroke"
                className="w-6 h-6 text-white stroke-white group-hover:text-[rgb(var(--hover))] group-hover:stroke-[rgb(var(--hover))] transition-colors"
                aria-hidden="true"
              >
                <path d="M3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM20 7.23792L12.0718 14.338L4 7.21594V19H20V7.23792ZM4.51146 5L12.0619 11.662L19.501 5H4.51146Z"></path>
              </svg>
            </a>
          </div>
        </header>
        <main className="container py-6">{children}</main>
        <footer className="border-t">
          <div className="container py-6 text-sm text-gray-500">Built with Next.js</div>
        </footer>
      </body>
    </html>
  )
}
