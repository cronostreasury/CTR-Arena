'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../scripts/lib/snapshot-core');

const fetchArgs = (rpcCall, extra = {}) => ({
  rpcCall, address: '0xabc', topic0: '0xddf', lpPad: '0x00', fromBlock: 0, latest: 5999, chunk: 2000, ...extra
});

test('safeCursor advances to head when nothing failed', () => {
  assert.equal(core.safeCursor(1000, []), 1000);
});

test('safeCursor holds back to just before the earliest failed block', () => {
  assert.equal(core.safeCursor(1000, [700, 400, 900]), 399);
  assert.equal(core.safeCursor(1000, [0]), 0);
});

test('fetchLogsChunked reports failed chunks instead of dropping them silently', async () => {
  const rpc = async (_m, [f]) => {
    if (f.fromBlock === '0x7d0') throw new Error('rpc down'); // chunk starting at 2000
    return [{ blockNumber: f.fromBlock }];
  };
  const { logs, failedBlocks } = await core.fetchLogsChunked(fetchArgs(rpc));
  assert.deepEqual(failedBlocks, [2000]);
  assert.equal(logs.length, 4); // 2 good chunks x 2 queries
  assert.equal(core.safeCursor(5999, failedBlocks), 1999);
});

test('fetchLogsChunked treats a missing result as failure, not "no logs"', async () => {
  const { logs, failedBlocks } = await core.fetchLogsChunked(fetchArgs(async () => undefined, { latest: 10 }));
  assert.deepEqual(failedBlocks, [0]);
  assert.equal(logs.length, 0);
});

test('fetchLogsChunked: one failing side of a chunk fails the whole chunk', async () => {
  let n = 0;
  const rpc = async () => { if (++n % 2 === 0) throw new Error('x'); return []; };
  const { failedBlocks } = await core.fetchLogsChunked(fetchArgs(rpc, { latest: 10 }));
  assert.deepEqual(failedBlocks, [0]);
});

test('readJsonStore: missing -> null, corrupt -> throws, valid -> parsed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-'));
  const f = path.join(dir, 't.json');
  assert.equal(core.readJsonStore(f), null);
  fs.writeFileSync(f, '{"trades": [');
  assert.throws(() => core.readJsonStore(f), /corrupt/);
  core.writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(core.readJsonStore(f), { a: 1 });
  assert.deepEqual(fs.readdirSync(dir), ['t.json']); // no temp file left behind
});

test('all three builders persist the safe cursor, not the raw chain head', () => {
  for (const f of ['build-snapshot.js', 'build-snapshot-sweep.js', 'build-snapshot-crab.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', f), 'utf8');
    assert.match(src, /lastBlock:\s*cursorBlock/, f);
    assert.doesNotMatch(src, /lastBlock:\s*latestBlock/, f);
    assert.match(src, /core\.safeCursor\(latestBlock, failedBlocks\)/, f);
  }
});
