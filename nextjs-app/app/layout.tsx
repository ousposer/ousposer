import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'OusPoser - Fresh Spots in Paris',
  description: 'Find the perfect cool spots in Paris for hot weather relief. Discover shaded areas with seating and convenience amenities.',
  keywords: ['Paris', 'fresh spots', 'cool places', 'shade', 'benches', 'hot weather'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50">
          {children}
        </div>
      </body>
    </html>
  )
}
