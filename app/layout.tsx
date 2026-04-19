import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CTR Tracker - Cronos Treasury Reserve',
  description: 'Live buy/sell tracker for CTR token on Cronos',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
