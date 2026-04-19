const CTR_CONTRACT = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')

  try {
    const r    = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CTR_CONTRACT}`)
    const data = await r.json()
    const pair = (data?.pairs || []).find(p => p.chainId === 'cronos') ?? data?.pairs?.[0]

    if (!pair) return res.status(200).json({ price: 0, change24h: 0, volume24h: 0, liquidity: 0, mcap: 0 })

    res.status(200).json({
      price:     parseFloat(pair.priceUsd           ?? '0'),
      change24h: parseFloat(pair.priceChange?.h24   ?? '0'),
      volume24h: parseFloat(pair.volume?.h24        ?? '0'),
      liquidity: parseFloat(pair.liquidity?.usd     ?? '0'),
      mcap:      parseFloat(pair.marketCap          ?? '0'),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
