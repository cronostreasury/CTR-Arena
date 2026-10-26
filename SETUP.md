# CTR Arena — Snapshot System Setup

How the data flow works and how to deploy.

The site runs three independent "seasons" (CTR, CRAB, SWEEP). Each one is a
static page at the repo root plus its own builder script, workflow and snapshot
files. Nothing is shared at runtime except `scripts/lib/snapshot-core.js`.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  GitHub Action (cron: every 5 min, per season)           │
│  scripts/build-snapshot{,-crab,-sweep}.js                │
│                                                          │
│  1. Reads the last processed block from data/trades*.json │
│  2. eth_getLogs over public Cronos RPC for LP transfers   │
│  3. Filters buys/sells, computes scores                   │
│  4. Computes deterministic jackpot rolls                  │
│  5. Fetches token balances via RPC                        │
│  6. Fetches price/volume from the DexScreener public API   │
│  7. Writes data/trades*.json + data/season*.json          │
│  8. git commit + push                                     │
└──────────────────────────────────────────────────────────┘
                     ↓
        GitHub Pages serves the JSON
                     ↓
┌──────────────────────────────────────────────────────────┐
│  Browser (index.html / CWK.html / SWEEP.html)            │
│  fetch('data/season*.json') ← instant load               │
│  Renders leaderboard, feed, jackpots                      │
└──────────────────────────────────────────────────────────┘
```

**No API key is required.** The builders read transfers and balances straight
from public Cronos JSON-RPC endpoints and get market data from the public
DexScreener endpoint. `CRONOS_API_KEY` is still read from the environment as an
optional value, but every current code path works without it.

## Seasons and their files

Each season is fully self-contained:

| Season | Page (entrypoint) | Snapshot | Trade store | Builder | Workflow |
| --- | --- | --- | --- | --- | --- |
| CTR | `index.html` (site root) | `data/season.json` | `data/trades.json` | `scripts/build-snapshot.js` | `.github/workflows/snapshot.yml` |
| CRAB | `CWK.html` | `data/season-crab.json` | `data/trades-crab.json` | `scripts/build-snapshot-crab.js` | `.github/workflows/snapshot-crab.yml` |
| SWEEP | `SWEEP.html` | `data/season-sweep.json` | `data/trades-sweep.json` | `scripts/build-snapshot-sweep.js` | `.github/workflows/snapshot-sweep.yml` |

`index.html` is the root entrypoint — it is what GitHub Pages serves at `/`.
The three pages are self-contained: each ships its own inline CSS and JS and
loads nothing from `assets/`.

## Files

```
/
├── index.html                        # CTR season — root entrypoint
├── CWK.html                          # CRAB season
├── SWEEP.html                        # SWEEP season
├── data/
│   ├── season.json                   # Auto-generated, DO NOT edit manually
│   ├── season-crab.json              #   "
│   ├── season-sweep.json             #   "
│   ├── trades.json                   # Auto-generated trade store + block cursor
│   ├── trades-crab.json              #   "
│   └── trades-sweep.json             #   "
├── scripts/
│   ├── build-snapshot.js             # CTR indexer (runs in Action)
│   ├── build-snapshot-crab.js        # CRAB indexer
│   ├── build-snapshot-sweep.js       # SWEEP indexer
│   └── lib/
│       └── snapshot-core.js          # Shared log fetching, JSON store, cursor
├── test/
│   └── snapshot-core.test.js         # node:test suite for snapshot-core
├── assets/
│   ├── js/config.js                  # Legacy, not loaded by any page (see README)
│   ├── js/app.js                     #   "
│   └── css/style.css                 #   "
└── .github/
    └── workflows/
        ├── snapshot.yml              # CTR action
        ├── snapshot-crab.yml         # CRAB action
        └── snapshot-sweep.yml        # SWEEP action
```

The builders have **no npm dependencies** — only Node builtins (`fs`, `path`,
global `fetch`) plus `scripts/lib/snapshot-core.js`. There is no `package.json`
and no install step in the workflows.

## One-time setup

1. **Enable Actions write permissions** (needed for the workflow to push commits):
   - `Settings → Actions → General → Workflow permissions`
   - Select `Read and write permissions`
   - Save

2. **Enable GitHub Pages:**
   - `Settings → Pages`
   - *Source:* **Deploy from a branch**, *Branch:* `main` / `/ (root)`
   - Save

3. **Optional — `CRONOS_API_KEY`:** not needed by any current code path. If a
   future explorer fallback requires one, add it as a repository secret
   (`Settings → Secrets and variables → Actions → New repository secret`,
   name `CRONOS_API_KEY`) and for local runs export it in your shell only.
   Never commit a key to the repo, docs, or `assets/js/config.js`.

   > **Security note:** a Cronos Explorer API key was committed to this
   > repository's history in `SETUP.md`. It is no longer in any tracked file,
   > but it remains reachable in the Git history. The repository credential
   > owner must revoke/rotate it with the provider and treat it as compromised.
   > Rotation is an owner action and cannot be done from the repo.

4. **Trigger the first run.** Each workflow runs automatically within 5 minutes,
   or trigger it manually:
   - `Actions` tab → pick `Build Season Snapshot`, `Build CRAB Season Snapshot`
     or `Build SWEEP Season Snapshot`
   - `Run workflow → Run workflow`

5. **Verify:**
   - After the run completes (~30 sec), check that the matching `data/season*.json`
     and `data/trades*.json` were committed
   - Open the page on GitHub Pages — leaderboard, feed and jackpots should populate

## What's stored in `season*.json`

This is the compact frontend snapshot. Raw trades are **not** in here — they
live in `trades*.json`.

```jsonc
{
  "updatedAt": 1712863200,                 // unix seconds, when the snapshot was written
  "seasonStart": 1742428800,
  "seasonEnd": 1745020800,
  "seasonDays": 30,
  "market": {                              // from DexScreener
    "price": 0.00489,                      // token/USD
    "change24h": 5.2,
    "volume24h": 12000,
    "liquidity": 45000,
    "buys24h": 23,
    "sells24h": 11
  },
  "stats": {
    "totalTrades": 1245,                   // all accumulated trades in the store
    "totalBuys": 800,
    "totalSells": 445,
    "totalWallets": 156,
    "totalBuyVolume": 145000,              // USD
    "totalSellVolume": 89000,
    "prizePool": 1250.5,                   // sum of jackpot refunds
    "jackpotsHit": 87
  },
  "wallets": {                             // ALL wallets, indexed by addr
    "0xabc...": {
      "rank": 1,                           // overall rank
      "fs": 12450.5,                       // final score
      "bV": 5000, "sV": 200,               // buy/sell volume USD
      "bC": 1020000, "sC": 40800,          // buy/sell volume in tokens
      "balC": 980000,                      // current token balance
      "aw": 0.95, "hb": 1.32,              // anti-wash, hold bonus
      "n": 18,                             // trade count
      "ft": 1742500000, "lt": 1712863000   // first/last trade timestamps
    }
  },
  "trades": [                              // last 100 for the live feed
    { "h": "0x...", "t": 1712863200, "ty": "buy", "w": "0x...",
      "ctr": 1500, "usd": 7.35, "s": 1 }   // s = 1 when the trade is in-season
  ],
  "jackpots": [                            // last 50 wins
    { "h": "0x...", "t": 1712860000, "w": "0x...", "tier": 0.50, "cn": "p50", "buy_usd": 25.0, "refund": 1.25 }
  ]
}
```

Every `market` field is **nullable, and `null` means "unknown"** — the metric
could not be fetched or failed validation. It never means zero. Each field is
validated independently, so one missing metric does not discard the others; if
the whole DexScreener call fails, all six are `null`. Consumers must treat
`null` as "no data" and render a placeholder rather than `0`.

## What's stored in `trades*.json`

The persistent indexer state. The builder reads it at the start of every run and
resumes from `lastBlock`, so a run only fetches new blocks.

```jsonc
{
  "lastBlock": 23456789,  // highest block safely processed; the resume cursor
  "updatedAt": 1712863200,
  "count": 1245,
  "trades": [ /* all accumulated trades, used for scoring on the next run */ ]
}
```

`lastBlock` is deliberately conservative: if any `eth_getLogs` chunk fails, the
cursor is held back to just before the earliest failed block so those blocks are
re-fetched on the next run instead of being skipped. A run that logs
`WARN: lastBlock held at …` has done this. Do not hand-edit this file — a
corrupt store makes the builder abort rather than silently rebuild over it.

## How buys/sells are identified

A token transfer event matches one of:
- **Buy**: `from = LP_pair, to ≠ LP_pair` → trader is `to`
- **Sell**: `to = LP_pair, from ≠ LP_pair` → trader is `from`

Excluded addresses (router contracts, treasury, zero address, etc.) are filtered
out so router-mediated trades land on the actual user wallet.

## How jackpots work (deterministic)

Each buy ≥ $10 produces a deterministic 0–999 roll from the tx hash:
```js
hashToPermille(txHash) → 0..999
```
- 0–1   → 100% refund (Legendary)
- 2–6   → 75% refund (Epic)
- 7–24  → 50% refund (Rare)
- 25–74 → 25% refund (Uncommon)
- 75–194 → 10% refund (Common)
- 195+  → no win (~80.5%)

Same tx hash always rolls the same result, so wins are reproducible and verifiable.

## Operations

**To re-run a workflow manually:** `Actions → <Build … Season Snapshot> → Run workflow`

The CTR workflow (`snapshot.yml`) also runs on push when
`scripts/build-snapshot.js`, `scripts/lib/**` or the workflow file itself
changes. The CRAB and SWEEP workflows are cron + manual only.

All three workflows push to `main`, and the cron schedules overlap. Each uses a
`concurrency` group plus a `git pull --rebase` retry loop so simultaneous runs
don't clobber each other. Expect snapshot commits on `main` every few minutes —
rebase local work rather than expecting a stable tip.

**To run a builder locally:**
```bash
node scripts/build-snapshot.js        # or -crab / -sweep
jq '.updatedAt, .stats' data/season.json
```
No API key or install step needed. The run writes to `data/`, so either discard
those changes afterwards or run it on a throwaway branch.

**To check the code without running it:**
```bash
node --check scripts/build-snapshot.js
node --test test/snapshot-core.test.js
```

Pass the test file explicitly (or run bare `node --test`, which discovers it).
`node --test test/` fails on current Node versions because the bare directory
name is resolved as a module specifier, not as a search path.

No workflow runs these tests today — they only gate changes if you run them.

**Troubleshooting:**
- Workflow fails with `permission denied`: check step 1 (write permissions)
- `season*.json` empty / old: check the Actions tab for failed runs
- `lastBlock held at …` in the log: an RPC chunk failed; the next run retries
  those blocks. Persistent holds mean the RPC endpoints are unhealthy.
- `market` fields `null`: the DexScreener fetch failed or returned an invalid
  value; the on-chain stats in the same snapshot are still valid
- Frontend says "Snapshot unavailable": the JSON didn't load. Check the browser
  DevTools network tab.

**Costs:** Free — but only because the repo is public. Three workflows on a
5-min cron are ~25900 runs/month; each takes ~30 sec but GitHub rounds every run
up to a full minute, so that is ~25900 billable minutes against a private-repo
free tier of 2000. Actions minutes are unlimited for public repos, so **keep the
repo public** (that also keeps GitHub Pages free).

## Why not real-time?

A 5-minute snapshot is plenty for a 30-day leaderboard. Real-time would require:
- A backend server running 24/7 (cost)
- A WebSocket connection to Cronos (fragile)
- A database with state (complexity)

The snapshot model gets you 95% of the value at 0% of the cost.
