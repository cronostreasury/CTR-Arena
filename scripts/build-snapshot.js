#!/usr/bin/env node
/**
 * CTR Trading Season — Snapshot Builder
 *
 * Runs in GitHub Actions every 5 minutes. Fetches all CTR token transfers
 * involving the LP pair from Cronos Explorer API, builds the leaderboard,
 * computes deterministic jackpot rolls, fetches CTR balances via RPC,
 * and writes a clean JSON snapshot to data/season.json.
 *
 * The frontend (season.html) reads this JSON. No API key, no RPC calls
 * from the browser.
 */

const fs = require('fs');
const path = require('path');

// ====================== CONFIG ======================
const API_KEY = process.env.CRONOS_API_KEY;
if (!API_KEY) {
  console.error('FATAL: CRONOS_API_KEY env var is missing');
  process.exit(1);
}

const CTR          = '0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC';
const LP           = '0xf118aa245b0627b4752607620d0048b492a5f4fb';
const TAX_WALLET   = '0x96A6cd06338eFE754f200Aba9fF07788c16E5F20';
const PRIZE_WALLET = '0x32bA7097fC2ce5b1A118Bf3347b492e414cB7C35';
const DEC          = 18;
const SD           = 30;        // Season duration in days
const TAX_RATE     = 0.10;
const JACKPOT_MIN_BUY = 10;     // USD
const SS           = new Date('2026-03-20T00:00:00Z');
const SS_TS        = Math.floor(SS.getTime() / 1000);

const RPC_LIST = [
  'https://evm.cronos.org',
  'https://cronos-evm-rpc.publicnode.com',
  'https://cronos.drpc.org',
  'https://rpc.vvs.finance'
];

// Excluded addresses — routers, contracts, zero address, etc.
const EX = new Set([
  CTR, TAX_WALLET, LP,
  '0x0000000000000000000000000000000000000000',
  '0x8EbC409998ef75661A4C464ff9bbb490586F954a',
  '0x1189331089b6ca8beA989C1F2fFd0EfAdCd33a69',
  '0xCd2E5cC83681d62BEb066Ad0a2ec94Bf301570C9',
  '0x8a44aC7D38B9925D2437803520ED38ae5C3120e5',
  '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0xcd7d16fB918511BF7269eC4f48d61D79Fb26f918',
  '0x145677FC4d9b8F19B5D56d1820c48e0443049a30'
].map(a => a.toLowerCase()));

const NON_USER_ADDRS = new Set(['0xec68090566397dcc37e54b30cc264b2d68cf0489']);

const JACKPOT_TIERS = [
  { pct: 1.00, weight: 2,   className: 'p100' },
  { pct: 0.75, weight: 5,   className: 'p75'  },
  { pct: 0.50, weight: 18,  className: 'p50'  },
  { pct: 0.25, weight: 50,  className: 'p25'  },
  { pct: 0.10, weight: 120, className: 'p10'  }
];
const JACKPOT_TOTAL_WEIGHT = JACKPOT_TIERS.reduce((s, t) => s + t.weight, 0);

// ====================== HELPERS ======================
const sleep = ms => new Promise(r => setTimeout(r, ms));

function round(n, decimals = 2) {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

// Deterministic 0-999 from tx hash (must match frontend logic)
function hashToPermille(hash) {
  const h = (hash || '').replace(/^0x/, '').padEnd(64, '0');
  let acc = 0;
  for (let i = 0; i < 12; i++) acc = (acc * 17 + parseInt(h[i], 16)) % 1000;
  return acc;
}

function jackpotRoll(hash) {
  const roll = hashToPermille(hash);
  if (roll >= JACKPOT_TOTAL_WEIGHT) return null;
  let sum = 0;
  for (const tier of JACKPOT_TIERS) {
    sum += tier.weight;
    if (roll < sum) return tier;
  }
  return null;
}

async function fetchJson(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ====================== FETCHERS ======================

/**
 * Fetch ALL CTR token transfers involving the LP pair, paginated.
 * Tries multiple API sources in order: BlockScout (proven), Cronos Explorer v1/v2.
 * Stops early when we go past the season start (results are sorted desc).
 */
async function fetchAllTransfers() {
  // Multiple API sources — first one that returns valid data wins
  const sources = [
    {
      name: 'BlockScout',
      url: page => `https://cronos.org/explorer/api`
        + `?module=account&action=tokentx`
        + `&contractaddress=${CTR}`
        + `&address=${LP}`
        + `&page=${page}&offset=10000&sort=desc`
    },
    {
      name: 'Cronos Explorer v1',
      url: page => `https://explorer-api.cronos.org/mainnet/api/v1/account/tokentx`
        + `?contractaddress=${CTR}`
        + `&address=${LP}`
        + `&page=${page}&offset=10000&sort=desc`
        + `&apikey=${API_KEY}`
    },
    {
      name: 'Cronos Explorer v2',
      url: page => `https://explorer-api.cronos.org/mainnet/api/v2/account/tokentx`
        + `?contractaddress=${CTR}`
        + `&address=${LP}`
        + `&page=${page}&offset=10000&sort=desc`
        + `&apikey=${API_KEY}`
    }
  ];

  let lastErr;
  for (const src of sources) {
    console.log(`  Trying ${src.name}...`);
    try {
      const all = [];
      for (let page = 1; page <= 5; page++) {
        let d;
        try {
          d = await fetchJson(src.url(page));
        } catch (e) {
          if (page === 1) throw e;
          console.warn(`    Page ${page} failed: ${e.message}`);
          break;
        }

        // Etherscan-compatible: status='1' means success, status='0' means empty result
        const ok = (d.status === '1' && Array.isArray(d.result))
                || (Array.isArray(d.result) && d.result.length > 0);
        if (!ok) {
          if (page === 1) throw new Error(`No data (status=${d.status}, msg=${d.message || 'unknown'})`);
          break;
        }

        let stopHere = false;
        for (const tx of d.result) {
          const ts = parseInt(tx.timeStamp || '0');
          if (ts < SS_TS) { stopHere = true; break; }
          all.push(tx);
        }
        console.log(`    Page ${page}: ${d.result.length} transfers (${all.length} total in season window)`);

        if (stopHere) break;
        if (d.result.length < 10000) break;
        await sleep(300);
      }

      if (all.length > 0) {
        console.log(`  ✓ ${src.name} succeeded with ${all.length} transfers`);
        return all;
      }
    } catch (e) {
      console.warn(`  ${src.name} failed: ${e.message}`);
      lastErr = e;
    }
  }

  throw new Error(`All transfer sources failed. Last error: ${lastErr?.message}`);
}

async function fetchPrice() {
  try {
    const d = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/cronos/${LP}`);
    const p = d.pair;
    if (!p) return { price: 0, change24h: 0, volume24h: 0, liquidity: 0, buys24h: 0, sells24h: 0 };
    return {
      price:      parseFloat(p.priceUsd) || 0,
      change24h:  parseFloat(p.priceChange?.h24) || 0,
      volume24h:  p.volume?.h24 || 0,
      liquidity:  p.liquidity?.usd || 0,
      buys24h:    p.txns?.h24?.buys || 0,
      sells24h:   p.txns?.h24?.sells || 0
    };
  } catch (e) {
    console.error('  DexScreener failed:', e.message);
    return { price: 0, change24h: 0, volume24h: 0, liquidity: 0, buys24h: 0, sells24h: 0 };
  }
}

let rpcIdx = 0;
async function rpcCall(method, params) {
  for (let i = 0; i < RPC_LIST.length; i++) {
    const url = RPC_LIST[(rpcIdx + i) % RPC_LIST.length];
    try {
      const r = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() })
      }, 15000);
      if (r.error) throw new Error(r.error.message);
      rpcIdx = (rpcIdx + i) % RPC_LIST.length;
      return r.result;
    } catch (e) {
      if (i === RPC_LIST.length - 1) throw e;
    }
  }
}

async function fetchBalance(addr) {
  try {
    const data = '0x70a08231000000000000000000000000' + addr.slice(2);
    const result = await rpcCall('eth_call', [{ to: CTR, data }, 'latest']);
    const bal = Number(BigInt(result || '0x0')) / Math.pow(10, DEC);
    return Number.isFinite(bal) ? bal : 0;
  } catch (e) {
    return 0;
  }
}

async function rpcGetTxFrom(hash) {
  try {
    const tx = await rpcCall('eth_getTransactionByHash', [hash]);
    if (tx && tx.from) return tx.from.toLowerCase();
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Resolve every unique tx hash → tx.from (the real user EOA that signed the tx).
 * This is the only reliable way to identify the actual trader on router-mediated trades.
 * Returns a map: hash → real-trader-address.
 */
async function resolveRealTraders(transfers) {
  const uniqueHashes = [...new Set(transfers.map(t => (t.hash || '').toLowerCase()).filter(Boolean))];
  const map = {};
  console.log(`  Resolving ${uniqueHashes.length} unique tx senders via RPC...`);

  let resolved = 0, failed = 0;
  for (let i = 0; i < uniqueHashes.length; i += 15) {
    const batch = uniqueHashes.slice(i, i + 15);
    const results = await Promise.all(batch.map(h => rpcGetTxFrom(h)));
    batch.forEach((h, j) => {
      if (results[j]) { map[h] = results[j]; resolved++; }
      else failed++;
    });
    if (i + 15 < uniqueHashes.length) await sleep(120);
    if ((i / 15) % 20 === 0 && i > 0) {
      console.log(`    Progress: ${resolved}/${uniqueHashes.length} resolved`);
    }
  }
  console.log(`  Resolved ${resolved} txs (${failed} failed)`);
  return map;
}

// ====================== BUILDERS ======================

function buildTrades(transfers, price, txFromMap) {
  const lp = LP.toLowerCase();
  const seen = new Set();
  const trades = [];
  let unresolved = 0;

  for (const tx of transfers) {
    const ts = parseInt(tx.timeStamp || '0');
    if (!ts || ts < SS_TS) continue;

    const from = (tx.from || '').toLowerCase();
    const to   = (tx.to   || '').toLowerCase();
    const hash = (tx.hash || '').toLowerCase();
    if (!hash) continue;

    // Dedup by hash + direction (multi-transfer txs handled correctly)
    const key = `${hash}:${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isBuy  = from === lp && to !== lp;
    const isSell = to   === lp && from !== lp;
    if (!isBuy && !isSell) continue;

    // The REAL trader is whoever signed the tx (always an EOA), NOT the
    // direct counterparty of the transfer (which is often a router contract).
    const trader = txFromMap[hash];
    if (!trader) { unresolved++; continue; }

    // Filter known non-user addresses (the LP, the contract itself, zero, etc.)
    if (EX.has(trader) || NON_USER_ADDRS.has(trader)) continue;

    const decimals = parseInt(tx.tokenDecimal || DEC);
    let ctr = 0;
    try {
      ctr = Number(BigInt(tx.value || '0')) / Math.pow(10, decimals);
    } catch (e) {
      ctr = parseFloat(tx.value || '0') / Math.pow(10, decimals);
    }
    if (!Number.isFinite(ctr) || ctr <= 0) continue;

    trades.push({
      h: hash,
      t: ts,
      ty: isBuy ? 'buy' : 'sell',
      w: trader,
      ctr,
      usd: ctr * price
    });
  }

  if (unresolved > 0) console.log(`  WARN: ${unresolved} transfers skipped (tx.from could not be resolved)`);
  return trades.sort((a, b) => b.t - a.t);
}

function buildJackpots(trades) {
  return trades
    .filter(t => t.ty === 'buy' && t.usd >= JACKPOT_MIN_BUY)
    .map(t => {
      const tier = jackpotRoll(t.h);
      if (!tier) return null;
      const taxPaid = t.usd * TAX_RATE;
      return {
        h: t.h,
        t: t.t,
        w: t.w,
        tier: tier.pct,
        cn: tier.className,
        buy_usd: t.usd,
        refund: taxPaid * tier.pct
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.t - a.t);
}

async function buildWallets(trades) {
  const tm = {};
  for (const tr of trades) {
    if (!tm[tr.w]) {
      tm[tr.w] = {
        addr: tr.w,
        bV: 0, sV: 0, bC: 0, sC: 0, balC: 0,
        ft: tr.t, lt: tr.t, n: 0
      };
    }
    const r = tm[tr.w];
    r.n++;
    r.lt = Math.max(r.lt, tr.t);
    r.ft = Math.min(r.ft, tr.t);
    if (tr.ty === 'buy')  { r.bV += tr.usd; r.bC += tr.ctr; }
    else                  { r.sV += tr.usd; r.sC += tr.ctr; }
  }

  // Fetch CTR balances for all wallets in parallel batches
  const wallets = Object.keys(tm);
  console.log(`  Fetching ${wallets.length} CTR balances via RPC...`);
  for (let i = 0; i < wallets.length; i += 10) {
    const batch = wallets.slice(i, i + 10);
    const bals = await Promise.all(batch.map(a => fetchBalance(a)));
    batch.forEach((a, j) => { tm[a].balC = bals[j]; });
    if (i + 10 < wallets.length) await sleep(100);
  }

  // Score
  const now = Date.now() / 1000;
  const sl = SD * 86400;

  const ranked = Object.values(tm).map(t => {
    const raw       = (3 * t.bV) + (1 * t.sV);
    const awBase    = t.bV > 0 ? Math.max(Math.min((t.bV - t.sV) / t.bV, 1), 0) : 0;
    const holdRatio = t.bC > 0 ? Math.max(Math.min(t.balC / t.bC, 1), 0) : 0;
    const aw        = awBase * holdRatio;
    const hb        = 1 + (Math.min(now - t.ft, sl) / sl) * 0.5;
    const fs        = raw * aw * hb;
    return { ...t, awBase, holdRatio, aw, hb, fs };
  }).sort((a, b) => b.fs - a.fs);

  ranked.forEach((w, i) => { w.rank = i + 1; });
  return ranked;
}

// ====================== MAIN ======================

async function main() {
  const t0 = Date.now();
  console.log('=== CTR Season Snapshot Builder ===');
  console.log('Time:', new Date().toISOString());
  console.log('Season start:', SS.toISOString(), `(${Math.floor((Date.now()/1000 - SS_TS) / 86400)} days ago)`);

  console.log('\n[1/6] Fetching DexScreener market data...');
  const market = await fetchPrice();
  console.log(`  Price: $${market.price.toFixed(6)} | 24h: ${market.change24h.toFixed(2)}% | Vol: $${market.volume24h.toFixed(0)} | Liq: $${market.liquidity.toFixed(0)}`);

  console.log('\n[2/6] Fetching transfers from explorer...');
  const transfers = await fetchAllTransfers();
  console.log(`  Total: ${transfers.length} transfers in season window`);

  if (transfers.length === 0) {
    throw new Error('Zero transfers returned — preserving previous snapshot.');
  }

  console.log('\n[3/6] Resolving real trader EOAs (tx.from for each tx)...');
  const txFromMap = await resolveRealTraders(transfers);

  console.log('\n[4/6] Building trades...');
  const trades = buildTrades(transfers, market.price, txFromMap);
  const totalBuys  = trades.filter(t => t.ty === 'buy').length;
  const totalSells = trades.filter(t => t.ty === 'sell').length;
  console.log(`  Filtered: ${trades.length} trades (${totalBuys} buys, ${totalSells} sells)`);

  console.log('\n[5/6] Computing jackpots...');
  const jackpots = buildJackpots(trades);
  const prizePool = jackpots.reduce((s, j) => s + j.refund, 0);
  console.log(`  Jackpot wins: ${jackpots.length} | Total refunds: $${prizePool.toFixed(2)}`);

  console.log('\n[6/6] Building wallets and scoring...');
  const wallets = await buildWallets(trades);
  const totalBuyVolume  = wallets.reduce((s, w) => s + w.bV, 0);
  const totalSellVolume = wallets.reduce((s, w) => s + w.sV, 0);
  console.log(`  Ranked: ${wallets.length} wallets | Top score: ${wallets[0]?.fs.toFixed(0) || 0}`);

  // Build wallet map (addr → stats) for frontend lookup
  const walletsMap = {};
  for (const w of wallets) {
    walletsMap[w.addr] = {
      rank: w.rank,
      fs:   round(w.fs),
      bV:   round(w.bV),
      sV:   round(w.sV),
      bC:   round(w.bC, 4),
      sC:   round(w.sC, 4),
      balC: round(w.balC, 4),
      aw:   round(w.aw, 4),
      hb:   round(w.hb, 4),
      n:    w.n,
      ft:   w.ft,
      lt:   w.lt
    };
  }

  // Limit feed and jackpots to keep JSON small (visible in UI anyway)
  const feedTrades = trades.slice(0, 100).map(t => ({
    h: t.h, t: t.t, ty: t.ty, w: t.w,
    ctr: round(t.ctr, 2),
    usd: round(t.usd, 2)
  }));

  const recentJackpots = jackpots.slice(0, 50).map(j => ({
    h: j.h, t: j.t, w: j.w,
    tier: j.tier, cn: j.cn,
    buy_usd: round(j.buy_usd),
    refund:  round(j.refund)
  }));

  const snapshot = {
    updatedAt:   Math.floor(Date.now() / 1000),
    seasonStart: SS_TS,
    seasonDays:  SD,
    market: {
      price:     market.price,
      change24h: market.change24h,
      volume24h: market.volume24h,
      liquidity: market.liquidity,
      buys24h:   market.buys24h,
      sells24h:  market.sells24h
    },
    stats: {
      totalTrades:     trades.length,
      totalBuys,
      totalSells,
      totalWallets:    wallets.length,
      totalBuyVolume:  round(totalBuyVolume),
      totalSellVolume: round(totalSellVolume),
      prizePool:       round(prizePool),
      jackpotsHit:     jackpots.length
    },
    wallets:  walletsMap,
    trades:   feedTrades,
    jackpots: recentJackpots
  };

  // Write
  const outDir  = path.join(__dirname, '..', 'data');
  const outPath = path.join(outDir, 'season.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const sizeKB  = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\nDone in ${elapsed}s. Wrote ${outPath} (${sizeKB} KB)`);
}

main().catch(e => {
  console.error('\nFAIL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
