const CTR_CONTRACT   = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC'
const LP_PAD  = '0x000000000000000000000xf118aa245b0627b4752607620d0048b492a5f4fb'.slice(0,66)
const RPC_URL = 'https://evm.cronos.org'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function pad(addr) {
  return '0x000000000000000000000000' + addr.slice(2).toLowerCase()
}
const LP    = '0xf118aa245b0627b4752607620d0048b492a5f4fb'
const VAULT = pad('0x96A6cd06338eFE754f200Aba9fF07788c16E5F20')
const DEAD  = pad('0x000000000000000000000000000000000000dEaD')
const LP_FROM = pad(LP)
const LP_TO   = pad(LP)

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const latest = parseInt(await rpc('eth_blockNumber', []), 16)
    const from   = latest - 2000

    // Test: nur letzte 2000 Blocks, kein Filter
    const logs = await rpc('eth_getLogs', [{
      address:   CTR_CONTRACT,
      topics:    [TRANSFER_TOPIC],
      fromBlock: '0x' + from.toString(16),
      toBlock:   '0x' + latest.toString(16),
    }])

    res.status(200).json({
      debug: {
        latestBlock: latest,
        fromBlock: from,
        rawLogsCount: (logs||[]).length,
        firstLog: (logs||[])[0] || null,
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
