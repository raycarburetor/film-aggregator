import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Indie Cinemas London', description: 'London cinema listings' }

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
            <nav className="text-sm">Spec build</nav>
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
