import { NextResponse } from 'next/server'

const CTR_CONTRACT = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC'

export async function GET() {
  try {
    const res  = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${CTR_CONTRACT}`,
      { next: { revalidate: 30 } }
    )
    const data = await res.json()

    const pair = (data?.pairs || []).find((p: { chainId: string }) => p.chainId === 'cronos')
      ?? data?.pairs?.[0]

    if (!pair) {
      return NextResponse.json({ price: 0, change24h: 0, volume24h: 0 })
    }

    return NextResponse.json({
      price:     parseFloat(pair.priceUsd     ?? '0'),
      change24h: parseFloat(pair.priceChange?.h24 ?? '0'),
      volume24h: parseFloat(pair.volume?.h24  ?? '0'),
      liquidity: parseFloat(pair.liquidity?.usd ?? '0'),
      mcap:      parseFloat(pair.marketCap    ?? '0'),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
