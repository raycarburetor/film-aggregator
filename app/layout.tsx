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
