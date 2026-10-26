'use strict';
/**
 * Regression tests for the two defects this suite exists to pin down:
 *
 *   1. A snapshot older than 15 minutes was still labelled LIVE. The builders
 *      run on a GitHub Actions `schedule:`, which in this repo has been
 *      delivering roughly every 4 hours against a declared five-minute cron,
 *      so the page was effectively never actually live.
 *
 *   2. Unavailable market data was written and rendered as the number 0, so
 *      "DexScreener is down" and "the real 24h change is 0%" looked identical.
 *
 * Covers the three cases that matter: missing, stale, and valid zero.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const core = require('../scripts/lib/snapshot-core');
const MS = require('../assets/js/market-state');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BUILDERS = ['build-snapshot.js', 'build-snapshot-sweep.js', 'build-snapshot-crab.js'];
const PAGES = ['index.html', 'CWK.html', 'SWEEP.html'];

const NOW = 1_800_000_000;

// ---------------------------------------------------------------- freshness

test('freshness: a snapshot inside the 15 minute window is live', () => {
  for (const age of [0, 1, 60, 119, 120, 600, 899, 900]) {
    const f = MS.freshness(NOW - age, NOW);
    assert.equal(f.state, 'fresh', `age ${age}s`);
    assert.equal(f.isLive, true, `age ${age}s`);
    assert.match(f.label, /^LIVE/, `age ${age}s`);
  }
  assert.equal(MS.MAX_FRESH_AGE_SEC, 900);
});

test('freshness: just past 15 minutes is stale and never says LIVE', () => {
  for (const age of [901, 1000, 3600, 86400, 15228 /* measured mean gap */]) {
    const f = MS.freshness(NOW - age, NOW);
    assert.equal(f.state, 'stale', `age ${age}s`);
    assert.equal(f.isLive, false, `age ${age}s`);
    assert.doesNotMatch(f.label, /LIVE/, `age ${age}s`);
    assert.match(f.label, /^STALE/, `age ${age}s`);
  }
});

test('freshness: 900 vs 901 seconds is the exact fresh/stale boundary', () => {
  assert.equal(MS.freshness(NOW - 900, NOW).state, 'fresh');
  assert.equal(MS.freshness(NOW - 901, NOW).state, 'stale');
});

test('freshness: the real observed cadence of this repo is reported stale', () => {
  // Measured from the bot commit history: mean gap ~253 min, max ~557 min.
  for (const minutes of [49, 93, 155, 254, 557]) {
    const f = MS.freshness(NOW - minutes * 60, NOW);
    assert.equal(f.state, 'stale', `${minutes}m old`);
    assert.equal(f.isLive, false, `${minutes}m old`);
  }
});

test('freshness: a missing or unusable timestamp is unavailable, not age 0', () => {
  for (const bad of [undefined, null, '', 'abc', NaN, Infinity, 0, -1, {}, [], true]) {
    const f = MS.freshness(bad, NOW);
    assert.equal(f.state, 'unavailable', `updatedAt=${String(bad)}`);
    assert.equal(f.isLive, false, `updatedAt=${String(bad)}`);
    assert.equal(f.ageSec, null, `updatedAt=${String(bad)}`);
    assert.doesNotMatch(f.label, /LIVE/, `updatedAt=${String(bad)}`);
  }
});

test('freshness: a slightly future timestamp is clamped, not treated as an error', () => {
  const f = MS.freshness(NOW + 30, NOW);
  assert.equal(f.state, 'fresh');
  assert.equal(f.ageSec, 0);
});

test('humanAge formats seconds/minutes/hours/days', () => {
  assert.equal(MS.humanAge(0), '0s');
  assert.equal(MS.humanAge(59), '59s');
  assert.equal(MS.humanAge(60), '1m');
  assert.equal(MS.humanAge(3599), '59m');
  assert.equal(MS.humanAge(3600), '1h');
  assert.equal(MS.humanAge(86400), '1d');
});

// ------------------------------------------------- validated values vs zero

// Shared table: [input, expected]. Drives both implementations so they cannot drift.
const NUM_CASES = [
  [0, 0], [-0, -0], ['0', 0], ['0.0', 0], [0.000007053, 0.000007053],
  [-12.5, -12.5], ['-12.5', -12.5], [1e21, 1e21], ['  42  ', 42],
  [null, null], [undefined, null], ['', null], ['   ', null], ['abc', null],
  ['12abc', null], [NaN, null], [Infinity, null], [-Infinity, null],
  [true, null], [false, null], [{}, null], [[], null], [() => 1, null]
];

test('validated numbers keep a real zero and reject everything unusable', () => {
  for (const [input, expected] of NUM_CASES) {
    assert.equal(MS.num(input), expected, `MarketState.num(${String(input)})`);
  }
});

test('the browser and builder validators agree on every case', () => {
  // market-state.js cannot require snapshot-core.js (the browser loads it
  // directly), so the two copies are pinned together here instead.
  for (const [input] of NUM_CASES) {
    assert.equal(core.validNumber(input), MS.num(input), `disagreement on ${String(input)}`);
  }
});

test('isPresent distinguishes a real zero from missing data', () => {
  assert.equal(MS.isPresent(0), true);
  assert.equal(MS.isPresent('0'), true);
  assert.equal(MS.isPresent(null), false);
  assert.equal(MS.isPresent(undefined), false);
  assert.equal(MS.isPresent(''), false);
});

// ---------------------------------------------------------------- formatting

test('formatters render a real zero as zero', () => {
  assert.equal(MS.fmtPrice(0), '$0.000000');
  assert.equal(MS.fmtUsd(0), '$0.00');
  assert.equal(MS.fmtPct(0), '+0.00%');
  assert.equal(MS.fmtCount(0), '0');
  assert.equal(MS.fmtCompact(0), '0');
});

test('formatters render missing data as a placeholder, never as zero', () => {
  for (const bad of [null, undefined, '', 'abc', NaN, Infinity, {}]) {
    const label = String(bad);
    assert.equal(MS.fmtPrice(bad), MS.PLACEHOLDER, `fmtPrice(${label})`);
    assert.equal(MS.fmtUsd(bad), MS.PLACEHOLDER, `fmtUsd(${label})`);
    assert.equal(MS.fmtPct(bad), MS.PLACEHOLDER, `fmtPct(${label})`);
    assert.equal(MS.fmtCount(bad), MS.PLACEHOLDER, `fmtCount(${label})`);
    assert.equal(MS.fmtCompact(bad), MS.PLACEHOLDER, `fmtCompact(${label})`);
  }
  // The placeholder must not be mistakable for a number.
  assert.equal(/\d/.test(MS.PLACEHOLDER), false);
});

test('a real price below the decimal floor is not flattened to zero', () => {
  // CRAB trades around 2.3e-11; six decimals would render it as "$0.000000",
  // which is indistinguishable from a real zero price.
  assert.equal(MS.fmtPrice(2.306e-11), '$2.31e-11');
  assert.equal(MS.fmtPrice(1e-7), '$1.00e-7');
  // The boundary and anything above it stays in fixed notation.
  assert.equal(MS.fmtPrice(0.000001), '$0.000001');
  // A genuine zero is still a plain zero, not exponential.
  assert.equal(MS.fmtPrice(0), '$0.000000');
  assert.doesNotMatch(MS.fmtPrice(0), /e/);
});

test('formatters still format real values correctly', () => {
  assert.equal(MS.fmtPrice(0.000007053), '$0.000007');
  assert.equal(MS.fmtUsd(0.54), '$0.54');
  assert.equal(MS.fmtUsd(4997.68), '$5.0K');
  assert.equal(MS.fmtUsd(2_500_000), '$2.50M');
  assert.equal(MS.fmtPct(-4.5), '-4.50%');
  assert.equal(MS.fmtPct(1.234), '+1.23%');
  assert.equal(MS.fmtCount(1234567), '1,234,567');
  assert.equal(MS.fmtCompact(511789.3382), '511.8K');
  assert.equal(MS.fmtCompact(5_253_744), '5.25M');
});

// ------------------------------------------------------------ market mapping

test('market(): a snapshot of real zeros keeps every zero', () => {
  const m = MS.market({ price: 0, change24h: 0, volume24h: 0, liquidity: 0, buys24h: 0, sells24h: 0 });
  for (const k of MS.MARKET_FIELDS) assert.equal(m[k], 0, k);
});

test('market(): a missing or partial market block yields null, not zero', () => {
  for (const absent of [undefined, null, {}, 'nope', 42]) {
    const m = MS.market(absent);
    for (const k of MS.MARKET_FIELDS) assert.equal(m[k], null, `${k} for ${String(absent)}`);
  }
  // One bad field must not take the valid ones down with it.
  const partial = MS.market({ price: 0.0001, change24h: null, volume24h: 'n/a', liquidity: 0 });
  assert.equal(partial.price, 0.0001);
  assert.equal(partial.change24h, null);
  assert.equal(partial.volume24h, null);
  assert.equal(partial.liquidity, 0);
  assert.equal(partial.buys24h, null);
});

test('extractMarket(): DexScreener zeros survive, missing fields become null', () => {
  const m = core.extractMarket({
    priceUsd: '0', priceChange: { h24: 0 }, volume: { h24: 0 },
    liquidity: { usd: 0 }, txns: { h24: { buys: 0, sells: 0 } }
  });
  for (const k of core.MARKET_FIELDS) assert.equal(m[k], 0, `${k} should stay 0`);

  const empty = core.extractMarket({});
  for (const k of core.MARKET_FIELDS) assert.equal(empty[k], null, `${k} should be null`);

  assert.deepEqual(core.extractMarket(null), empty);

  // A realistic partial payload: price present, 24h txn counts absent.
  const real = core.extractMarket({ priceUsd: '0.000007053', liquidity: { usd: 4997.68 } });
  assert.equal(real.price, 0.000007053);
  assert.equal(real.liquidity, 4997.68);
  assert.equal(real.buys24h, null);
  assert.equal(real.sells24h, null);
});

test('MARKET_UNAVAILABLE is all null and cannot be mutated by a caller', () => {
  for (const k of core.MARKET_FIELDS) assert.equal(core.MARKET_UNAVAILABLE[k], null, k);
  const copy = { ...core.MARKET_UNAVAILABLE };
  copy.price = 1;
  assert.equal(core.MARKET_UNAVAILABLE.price, null, 'spreading must not alias the frozen default');
});

// -------------------------------------------------- builder / page contracts

test('no builder falls back to a zeroed market any more', () => {
  for (const f of BUILDERS) {
    const src = read(path.join('scripts', f));
    assert.doesNotMatch(src, /price:\s*0,\s*change24h:\s*0/, `${f} still has the zero-market literal`);
    assert.doesNotMatch(src, /parseFloat\(p\.priceUsd\)\s*\|\|\s*0/, `${f} still coerces price to 0`);
    assert.match(src, /core\.MARKET_UNAVAILABLE/, `${f} should emit nulls when the source fails`);
    assert.match(src, /core\.extractMarket\(/, `${f} should map pair data through the shared validator`);
  }
});

test('no builder values new trades without a price', () => {
  for (const f of BUILDERS) {
    const src = read(path.join('scripts', f));
    assert.match(src, /const priceAvailable = market\.price !== null/, f);
    assert.match(src, /priceAvailable \? buildTrades\(transfers, market\.price, txFromMap\) : \[\]/, f);
    // The blocks must be held back for a retry, not silently skipped.
    assert.match(src, /if \(!priceAvailable && transfers\.length\)/, f);
  }
});

test('every page loads the shared state module and dropped the unconditional LIVE', () => {
  for (const p of PAGES) {
    const src = read(p);
    assert.match(src, /<script src="assets\/js\/market-state\.js"><\/script>/, `${p} must load market-state.js`);
    // The old bug: 'LIVE · ' + ageMin + 'm ago' regardless of age.
    assert.doesNotMatch(src, /'LIVE · just updated'/, `${p} still builds a LIVE label unconditionally`);
    assert.doesNotMatch(src, /ageMin<2\?/, `${p} still has the old age branch`);
    assert.match(src, /MS\.freshness\(s\.updatedAt/, `${p} must derive status from updatedAt`);
    // A hardcoded LIVE badge in the markup cannot reflect freshness.
    assert.doesNotMatch(src, /<div class="badge bl"><div class="d"><\/div>LIVE<\/div>/, `${p} has a hardcoded LIVE badge`);
  }
});

test('no page paints zeros before data has loaded', () => {
  for (const p of PAGES) {
    const src = read(p);
    assert.doesNotMatch(src, /updTicker\(0,0,0,0,0,0\)/, `${p} still seeds the ticker with zeros`);
    assert.match(src, /updTicker\(MS\.market\(null\)\)/, `${p} should seed the ticker as unavailable`);
    for (const id of ['sPrice', 'sVolume', 'sLiquidity', 'sTraders', 'sTrades']) {
      const m = src.match(new RegExp(`id="${id}">([^<]*)<`));
      assert.ok(m, `${p}: could not find the ${id} placeholder`);
      assert.equal(/\d/.test(m[1]), false, `${p}: ${id} placeholder "${m[1]}" looks like a real value`);
    }
  }
});

test('the script each page references actually exists on disk', () => {
  // The pages now hard-depend on a file that did not exist before. Shipping the
  // HTML without it would break all three pages completely, so the referenced
  // path is resolved here rather than trusted.
  for (const p of PAGES) {
    const refs = read(p).match(/<script src="([^"]+)"><\/script>/g) || [];
    assert.ok(refs.length > 0, `${p} references no external script`);
    for (const ref of refs) {
      const rel = ref.match(/src="([^"]+)"/)[1];
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${p} references missing file ${rel}`);
    }
  }
  // And it must be loadable as the module the tests and pages both expect.
  assert.equal(typeof MS.freshness, 'function');
  assert.equal(typeof MS.market, 'function');
});

test('a sell-only wallet is not reported as having no trades', () => {
  for (const p of PAGES) {
    const src = read(p);
    // bV === 0 is a real figure for a wallet that only sold.
    assert.doesNotMatch(src, /if\(!trader\|\|!trader\.bV\)/, `${p} still treats bV === 0 as missing`);
  }
});
