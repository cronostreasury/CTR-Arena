const CTR_CONTRACT = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC'
const LP    = '0xf118aa245b0627b4752607620d0048b492a5f4fb'
const VAULT = '0x96a6cd06338efe754f200aba9ff07788c16e5f20'
const DEAD  = '0x000000000000000000000000000000000000dead'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40')
  try {
    // Blockscout v2 REST API - kein Key noetig
    const url  = `https://explorer-api.cronos.org/mainnet/api/v2/tokens/${CTR_CONTRACT}/transfers?limit=50`
    const r    = await fetch(url, { headers: { 'Accept': 'application/json' } })
    const data = await r.json()

    const items = data.items || data.result || []
    if (!items.length) {
      return res.status(200).json({ transactions: [], stats: { total:0, buyCount:0, sellCount:0, buyVolume:0, sellVolume:0, traders:0 }, debug: JSON.stringify(data).slice(0,200) })
    }

    const txs = []
    for (const tx of items) {
      const from = (tx.from?.hash || tx.from || '').toLowerCase()
      const to   = (tx.to?.hash   || tx.to   || '').toLowerCase()
      if (to === VAULT) continue
      if (to === DEAD)  continue
      const amount = parseFloat(tx.total?.value || tx.value || '0') / 1e18
      if (amount < 1) continue
      let type
      if (from === LP)    type = 'BUY'
      else if (to === LP) type = 'SELL'
      else                type = 'TRANSFER'
      const ts = tx.timestamp ? Math.floor(new Date(tx.timestamp).getTime()/1000) : 0
      txs.push({ hash: tx.tx_hash || tx.hash, block: parseInt(tx.block_number||'0'), type, amount, trader: type==='BUY'?to:from, from, to, timestamp: ts })
    }

    const buys  = txs.filter(t => t.type === 'BUY')
    const sells = txs.filter(t => t.type === 'SELL')
    res.status(200).json({
      transactions: txs,
      stats: { total: txs.length, buyCount: buys.length, sellCount: sells.length, buyVolume: buys.reduce((s,t)=>s+t.amount,0), sellVolume: sells.reduce((s,t)=>s+t.amount,0), traders: new Set(txs.map(t=>t.trader)).size }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
