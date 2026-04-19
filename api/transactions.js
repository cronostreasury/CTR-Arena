const CTR_CONTRACT = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC'
const LP    = '0xf118aa245b0627b4752607620d0048b492a5f4fb'
const VAULT = '0x96a6cd06338efe754f200aba9ff07788c16e5f20'
const DEAD  = '0x000000000000000000000000000000000000dead'
const API_KEY = 'ckey_951452f88ecf7e'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40')
  try {
    // LP-Adresse als address -> holt alle CTR Trades durch den Pool
    const url = `https://explorer-api.cronos.org/mainnet/api/v1/account/tokentx?contractaddress=${CTR_CONTRACT}&address=${LP}&page=1&offset=200&sort=desc&apikey=${API_KEY}`
    const r    = await fetch(url)
    const data = await r.json()

    if (data.status !== '1' || !Array.isArray(data.result)) {
      return res.status(200).json({ transactions: [], stats: { total:0, buyCount:0, sellCount:0, buyVolume:0, sellVolume:0, traders:0 }, debug: data.message })
    }

    const txs = []
    for (const tx of data.result) {
      const from = (tx.from || '').toLowerCase()
      const to   = (tx.to   || '').toLowerCase()
      if (to === VAULT) continue
      if (to === DEAD)  continue
      let amount
      try { amount = Number(BigInt(tx.value || '0')) / 1e18 }
      catch { amount = parseFloat(tx.value || '0') / 1e18 }
      if (amount < 1) continue
      let type
      if (from === LP)    type = 'BUY'
      else if (to === LP) type = 'SELL'
      else                type = 'TRANSFER'
      txs.push({ hash: tx.hash, block: parseInt(tx.blockNumber||'0'), type, amount, trader: type==='BUY'?to:from, from, to, timestamp: parseInt(tx.timeStamp||'0') })
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
