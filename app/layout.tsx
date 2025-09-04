import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Film Aggregator', description: 'London cinema listings' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b">
          <div className="container py-4 flex items-center justify-between">
            <a href="/" className="text-xl font-semibold">🎬 Film Aggregator</a>
            <nav className="text-sm text-gray-600">Spec build</nav>
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
