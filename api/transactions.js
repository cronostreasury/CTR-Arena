// api/transactions.js - optimiert fuer Vercel Free Tier (10s timeout)

const CTR_CONTRACT   = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC'
const LP_ADDRESS     = '0xf118aa245b0627b4752607620d0048b492a5f4fb'
const VAULT_WALLET   = '0x96A6cd06338eFE754f200Aba9fF07788c16E5F20'
const DEAD_WALLET    = '0x000000000000000000000000000000000000dEaD'
const RPC_URL        = 'https://evm.cronos.org'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const BLOCK_CHUNK    = 2000
const BLOCKS_BACK    = 6000

function pad(addr) {
  return '0x000000000000000000000000' + addr.slice(2).toLowerCase()
}
const LP_PAD    = pad(LP_ADDRESS)
const VAULT_PAD = pad(VAULT_WALLET)
const DEAD_PAD  = pad(DEAD_WALLET)

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40')

  try {
    const latestBlock = await getBlockNumber()
    const fromBlock   = Math.max(0, latestBlock - BLOCKS_BACK)

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
      if (toTopic === VAULT_PAD) continue
      if (toTopic === DEAD_PAD)  continue
      const amount = parseInt(log.data, 16) / 1e18
      if (amount < 1) continue
      const fromAddr = ('0x' + fromTopic.slice(26)).toLowerCase()
      const toAddr   = ('0x' + toTopic.slice(26)).toLowerCase()
      const block    = parseInt(log.blockNumber, 16)
      let type
      if (fromTopic === LP_PAD)    type = 'BUY'
      else if (toTopic === LP_PAD) type = 'SELL'
      else                         type = 'TRANSFER'
      const trader = type === 'BUY' ? toAddr : fromAddr
      txs.push({ hash: log.transactionHash, block, type, amount, trader, from: fromAddr, to: toAddr, timestamp: now - (latestBlock - block) * 6 })
    }

    txs.sort((a, b) => b.block - a.block)
    const buys    = txs.filter(t => t.type === 'BUY')
    const sells   = txs.filter(t => t.type === 'SELL')
    const buyVol  = buys.reduce((s, t) => s + t.amount, 0)
    const sellVol = sells.reduce((s, t) => s + t.amount, 0)

    res.status(200).json({
      transactions: txs,
      stats: { total: txs.length, buyCount: buys.length, sellCount: sells.length, buyVolume: buyVol, sellVolume: sellVol, traders: new Set(txs.map(t => t.trader)).size, latestBlock }
    })
  } catch (err) {
    console.error('[CTR API]', err.message)
    res.status(500).json({ error: err.message })
  }
}
