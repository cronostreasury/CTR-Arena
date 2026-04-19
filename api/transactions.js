// api/transactions.js
// Vercel Serverless Function - laeuft server-side, kein CORS-Problem

const CTR_CONTRACT   = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC'
const LP_ADDRESS     = '0xf118aa245b0627b4752607620d0048b492a5f4fb'
const VAULT_WALLET   = '0x96A6cd06338eFE754f200Aba9fF07788c16E5F20'
const DEAD_WALLET    = '0x000000000000000000000000000000000000dEaD'
const RPC_URL        = 'https://evm.cronos.org'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const BLOCK_CHUNK    = 2000
const BLOCKS_BACK    = 14400  // ~24h at 6s/block
const MAX_RESOLVE    = 60

function pad(addr) {
  return '0x000000000000000000000000' + addr.slice(2).toLowerCase()
}
const LP_PAD    = pad(LP_ADDRESS)
const VAULT_PAD = pad(VAULT_WALLET)
const DEAD_PAD  = pad(DEAD_WALLET)

// module-level cache survives warm Lambda invocations
const traderCache = new Map()

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.result
}

async function getBlockNumber() {
  return parseInt(await rpc('eth_blockNumber', []), 16)
}

async function getLogs(fromBlock, toBlock) {
  const result = await rpc('eth_getLogs', [{
    address: CTR_CONTRACT,
    topics: [TRANSFER_TOPIC],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }])
  return result || []
}

async function resolveTrader(txHash) {
  if (traderCache.has(txHash)) return traderCache.get(txHash)
  try {
    const tx = await rpc('eth_getTransactionByHash', [txHash])
    if (!tx?.from) return null
    const from = tx.from.toLowerCase()
    traderCache.set(txHash, from)
    return from
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  // CORS headers so the HTML files can call this
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')
  // Cache on Vercel edge for 20 seconds
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40')

  try {
    const latestBlock = await getBlockNumber()
    const fromBlock   = Math.max(0, latestBlock - BLOCKS_BACK)

    // chunked parallel fetching
    const chunks = []
    for (let b = fromBlock; b < latestBlock; b += BLOCK_CHUNK) {
      chunks.push(getLogs(b, Math.min(b + BLOCK_CHUNK - 1, latestBlock)))
    }
    const allLogs = (await Promise.all(chunks)).flat()

    const now = Math.floor(Date.now() / 1000)
    const txs = []

    for (const log of allLogs) {
      if (log.topics.length < 3) continue

      const fromTopic = log.topics[1]
      const toTopic   = log.topics[2]

      // filter vault tax transfers and dead wallet
      if (toTopic === VAULT_PAD) continue
      if (toTopic === DEAD_PAD)  continue

      const amount = parseInt(log.data, 16) / 1e18
      if (amount < 1) continue // skip dust

      const fromAddr = ('0x' + fromTopic.slice(26)).toLowerCase()
      const toAddr   = ('0x' + toTopic.slice(26)).toLowerCase()
      const block    = parseInt(log.blockNumber, 16)

      let type
      if (fromTopic === LP_PAD)    type = 'BUY'
      else if (toTopic === LP_PAD) type = 'SELL'
      else                         type = 'TRANSFER'

      const blocksAgo = latestBlock - block
      txs.push({
        hash:      log.transactionHash,
        block,
        type,
        amount,
        trader:    null,
        from:      fromAddr,
        to:        toAddr,
        timestamp: now - blocksAgo * 6,
      })
    }

    // sort newest first
    txs.sort((a, b) => b.block - a.block)

    // resolve traders for top N txs (server-side, no CORS)
    await Promise.allSettled(
      txs.slice(0, MAX_RESOLVE).map(async tx => {
        tx.trader = await resolveTrader(tx.hash)
        if (!tx.trader) tx.trader = tx.type === 'BUY' ? tx.to : tx.from
      })
    )
    // fallback for the rest
    txs.slice(MAX_RESOLVE).forEach(tx => {
      tx.trader = tx.type === 'BUY' ? tx.to : tx.from
    })

    const buys    = txs.filter(t => t.type === 'BUY')
    const sells   = txs.filter(t => t.type === 'SELL')
    const buyVol  = buys.reduce((s, t) => s + t.amount, 0)
    const sellVol = sells.reduce((s, t) => s + t.amount, 0)
    const traders = new Set(txs.map(t => t.trader).filter(Boolean)).size

    res.status(200).json({
      transactions: txs,
      stats: {
        total: txs.length,
        buyCount: buys.length,
        sellCount: sells.length,
        buyVolume: buyVol,
        sellVolume: sellVol,
        traders,
        latestBlock,
      }
    })

  } catch (err) {
    console.error('[CTR API]', err.message)
    res.status(500).json({ error: err.message })
  }
}
