'use strict';
/**
 * Shared, side-effect-light helpers for the snapshot builders.
 *
 * The builders persist a block cursor (`lastBlock`) and resume from it on the
 * next run. Anything that fails while processing a block range MUST hold that
 * cursor back, otherwise the affected blocks are never fetched again.
 */

const fs = require('fs');
const path = require('path');

/**
 * Read a JSON file. Returns null if the file does not exist.
 * Throws if it exists but cannot be parsed, so a corrupt store is never
 * mistaken for an empty one (which would be overwritten with a partial rebuild).
 */
function readJsonStore(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path.basename(file)} is corrupt (${e.message}); refusing to overwrite`);
  }
}

/** Write via temp file + rename so readers/commits never see a half-written file. */
function writeJsonAtomic(file, data, space) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, space));
  fs.renameSync(tmp, file);
}

/**
 * Query Transfer logs (LP as sender and LP as receiver) in fixed-size block
 * chunks. A chunk that fails on every RPC is NOT silently dropped: its start
 * block is returned in `failedBlocks` so the caller can hold its cursor back.
 */
async function fetchLogsChunked({
  rpcCall, address, topic0, lpPad, fromBlock, latest,
  chunk = 2000, parallel = 4, sleep = () => Promise.resolve(), log = () => {}
}) {
  const chunks = [];
  for (let start = fromBlock; start <= latest; start += chunk) {
    chunks.push({ start, end: Math.min(start + chunk - 1, latest) });
  }
  log(`  ${chunks.length} chunks of ${chunk} to query...`);

  const logs = [];
  const failedBlocks = [];
  let done = 0;

  for (let i = 0; i < chunks.length; i += parallel) {
    const batch = chunks.slice(i, i + parallel);
    const results = await Promise.all(batch.map(async ({ start, end }) => {
      const fb = '0x' + start.toString(16);
      const tb = '0x' + end.toString(16);
      try {
        const [fromLogs, toLogs] = await Promise.all([
          rpcCall('eth_getLogs', [{ address, fromBlock: fb, toBlock: tb, topics: [topic0, lpPad, null] }]),
          rpcCall('eth_getLogs', [{ address, fromBlock: fb, toBlock: tb, topics: [topic0, null, lpPad] }])
        ]);
        // A node answering without a result array is a failure, not "no logs".
        if (!Array.isArray(fromLogs) || !Array.isArray(toLogs)) throw new Error('malformed eth_getLogs response');
        return { logs: [...fromLogs, ...toLogs] };
      } catch (e) {
        return { failedStart: start };
      }
    }));
    for (const r of results) {
      if (r.failedStart !== undefined) failedBlocks.push(r.failedStart);
      else logs.push(...r.logs);
    }
    done += batch.length;
    if (done % 40 === 0 || done === chunks.length) {
      log(`    Progress: ${done}/${chunks.length} chunks -- ${logs.length} logs`);
    }
    if (i + parallel < chunks.length) await sleep(50);
  }
  return { logs, failedBlocks };
}

/**
 * Highest block that is safe to persist as the resume cursor: everything up to
 * and including it was fully processed. With no failures that is `latest`.
 */
function safeCursor(latest, failedBlocks) {
  const valid = (failedBlocks || []).filter(Number.isFinite);
  if (!valid.length) return latest;
  return Math.max(0, Math.min(...valid) - 1);
}

/**
 * Validate a value from an external API as a real number.
 *
 * Returns the number — including a genuine 0 — or null when the value is
 * missing, empty, or not finite. The point is that `null` and `0` stay
 * distinguishable all the way to the page: `parseFloat(x) || 0` collapses
 * "the API gave us nothing" and "the real figure is zero" into the same
 * displayable zero, which is what made unavailable market data look real.
 *
 * Mirrors MarketState.num() in assets/js/market-state.js (which the browser
 * loads directly and so cannot require this file); test/market-state.test.js
 * asserts the two implementations agree.
 */
function validNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MARKET_FIELDS = ['price', 'change24h', 'volume24h', 'liquidity', 'buys24h', 'sells24h'];

/** Every metric unknown — used when the market source cannot be reached at all. */
const MARKET_UNAVAILABLE = Object.freeze({
  price: null, change24h: null, volume24h: null, liquidity: null, buys24h: null, sells24h: null
});

/**
 * Map a DexScreener pair object onto the snapshot's `market` shape, validating
 * each field independently so one missing metric does not discard the others.
 */
function extractMarket(pair) {
  const p = pair || {};
  const txns = (p.txns && p.txns.h24) || {};
  return {
    price:     validNumber(p.priceUsd),
    change24h: validNumber(p.priceChange && p.priceChange.h24),
    volume24h: validNumber(p.volume && p.volume.h24),
    liquidity: validNumber(p.liquidity && p.liquidity.usd),
    buys24h:   validNumber(txns.buys),
    sells24h:  validNumber(txns.sells)
  };
}

module.exports = {
  readJsonStore, writeJsonAtomic, fetchLogsChunked, safeCursor,
  validNumber, extractMarket, MARKET_FIELDS, MARKET_UNAVAILABLE
};
