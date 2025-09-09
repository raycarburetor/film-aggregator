import './globals.css'
import type { Metadata, Viewport } from 'next'

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
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-white border-t-0 border-l-0 border-r-0 bg-black text-white">
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
