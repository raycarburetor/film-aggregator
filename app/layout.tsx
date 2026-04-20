import './globals.css'
import './redesign.css'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Suspense } from 'react'
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
  themeColor: '#000000',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500&family=Instrument+Serif:ital@0;1&family=Geist+Mono:wght@300;400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
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
        <Suspense fallback={null}>
          <StartTimeProvider>
            {children}
          </StartTimeProvider>
        </Suspense>
      </body>
    </html>
  )
}
