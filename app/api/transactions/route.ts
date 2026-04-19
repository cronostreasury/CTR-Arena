import { NextResponse } from 'next/server'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const CTR_CONTRACT   = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC'
const LP_ADDRESS     = '0xf118aa245b0627b4752607620d0048b492a5f4fb'
const VAULT_WALLET   = '0x96A6cd06338eFE754f200Aba9fF07788c16E5F20'
const DEAD_WALLET    = '0x000000000000000000000000000000000000dEaD'
const RPC_URL        = 'https://evm.cronos.org'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const BLOCK_CHUNK    = 8000
const BLOCKS_BACK    = 14400  // ~24h at 6s/block
const MAX_RESOLVE    = 60     // max trader resolutions per request

// pad address to 32-byte topic format
function pad(addr: string) {
  return '0x000000000000000000000000' + addr.slice(2).toLowerCase()
}
const LP_PAD    = pad(LP_ADDRESS)
const VAULT_PAD = pad(VAULT_WALLET)
const DEAD_PAD  = pad(DEAD_WALLET)

// ─── SERVER-SIDE TRADER CACHE (survives between revalidations) ────────────────
const traderCache = new Map<string, string>()

// ─── RPC HELPERS ─────────────────────────────────────────────────────────────
async function rpcCall(method: string, params: unknown[]) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    // no cache - always fresh from RPC
    cache: 'no-store',
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.result
}

async function getBlockNumber(): Promise<number> {
  const hex = await rpcCall('eth_blockNumber', [])
  return parseInt(hex, 16)
}

async function getLogs(fromBlock: number, toBlock: number) {
  const result = await rpcCall('eth_getLogs', [{
    address: CTR_CONTRACT,
    topics: [TRANSFER_TOPIC],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }])
  return (result || []) as RawLog[]
}

async function resolveTrader(txHash: string): Promise<string | null> {
  if (traderCache.has(txHash)) return traderCache.get(txHash)!
  try {
    const tx = await rpcCall('eth_getTransactionByHash', [txHash])
    if (!tx?.from) return null
    const from = tx.from.toLowerCase()
    traderCache.set(txHash, from)
    return from
  } catch {
    return null
  }
}

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface RawLog {
  transactionHash: string
  blockNumber: string
  topics: string[]
  data: string
}

export interface Transaction {
  hash: string
  block: number
  type: 'BUY' | 'SELL' | 'TRANSFER'
  amount: number
  trader: string | null
  from: string
  to: string
  timestamp: number
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const latestBlock = await getBlockNumber()
    const fromBlock   = Math.max(0, latestBlock - BLOCKS_BACK)

    // chunked log fetching
    const logPromises: Promise<RawLog[]>[] = []
    for (let b = fromBlock; b < latestBlock; b += BLOCK_CHUNK) {
      const to = Math.min(b + BLOCK_CHUNK - 1, latestBlock)
      logPromises.push(getLogs(b, to))
    }
    const logChunks = await Promise.all(logPromises)
    const allLogs   = logChunks.flat()

    // parse logs
    const txs: Transaction[] = []
    const now = Math.floor(Date.now() / 1000)

    for (const log of allLogs) {
      if (log.topics.length < 3) continue

      const fromTopic = log.topics[1]
      const toTopic   = log.topics[2]

      // filter out vault tax transfers and dead wallet
      if (toTopic === VAULT_PAD) continue
      if (toTopic === DEAD_PAD)  continue

      const amount = parseInt(log.data, 16) / 1e18
      if (amount < 1) continue  // skip dust

      const fromAddr = ('0x' + fromTopic.slice(26)).toLowerCase()
      const toAddr   = ('0x' + toTopic.slice(26)).toLowerCase()
      const block    = parseInt(log.blockNumber, 16)

      let type: 'BUY' | 'SELL' | 'TRANSFER'
      if (fromTopic === LP_PAD)    type = 'BUY'
      else if (toTopic === LP_PAD) type = 'SELL'
      else                         type = 'TRANSFER'

      // estimate timestamp from block distance
      const blocksAgo = latestBlock - block
      const timestamp = now - blocksAgo * 6

      txs.push({
        hash:      log.transactionHash,
        block,
        type,
        amount,
        trader:    null,
        from:      fromAddr,
        to:        toAddr,
        timestamp,
      })
    }

    // sort newest first
    txs.sort((a, b) => b.block - a.block)

    // resolve traders for the most recent transactions
    const toResolve = txs.slice(0, MAX_RESOLVE)
    await Promise.allSettled(
      toResolve.map(async tx => {
        tx.trader = await resolveTrader(tx.hash)
        // fallback: use the logical counterparty address
        if (!tx.trader) {
          tx.trader = tx.type === 'BUY' ? tx.to : tx.from
        }
      })
    )

    // for older txs without trader resolution, set fallback
    txs.slice(MAX_RESOLVE).forEach(tx => {
      tx.trader = tx.type === 'BUY' ? tx.to : tx.from
    })

    // build summary stats
    const buys    = txs.filter(t => t.type === 'BUY')
    const sells   = txs.filter(t => t.type === 'SELL')
    const buyVol  = buys.reduce((s, t)  => s + t.amount, 0)
    const sellVol = sells.reduce((s, t) => s + t.amount, 0)
    const traders = new Set(txs.map(t => t.trader).filter(Boolean)).size

    return NextResponse.json({
      transactions: txs,
      stats: {
        total:    txs.length,
        buyCount: buys.length,
        sellCount: sells.length,
        buyVolume:  buyVol,
        sellVolume: sellVol,
        traders,
        latestBlock,
        blocksBack: BLOCKS_BACK,
      }
    }, {
      headers: {
        // cache on Vercel edge for 15 seconds
        'Cache-Control': 's-maxage=15, stale-while-revalidate=30',
      }
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[CTR Tracker API]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
