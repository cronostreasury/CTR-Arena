# CTR Trading Season — Snapshot System Setup

How the data flow works and how to deploy.

## Architecture

```
┌─────────────────────────────────────────────┐
│  GitHub Action (cron: every 5 min)          │
│  scripts/build-snapshot.js                  │
│                                             │
│  1. Reads CRONOS_API_KEY from GH Secrets    │
│  2. Calls Cronos Explorer API (tokentx)     │
│  3. Filters buys/sells, computes scores     │
│  4. Computes deterministic jackpot rolls    │
│  5. Fetches CTR balances via RPC            │
│  6. Writes data/season.json                 │
│  7. git commit + push                       │
└─────────────────────────────────────────────┘
                     ↓
        GitHub Pages serves the JSON
                     ↓
┌─────────────────────────────────────────────┐
│  Browser (season.html)                      │
│  fetch('data/season.json') ← instant load  │
│  Renders leaderboard, feed, jackpots        │
└─────────────────────────────────────────────┘
```

## Files

```
/
├── season.html                       # Frontend (reads JSON only)
├── data/
│   └── season.json                   # Auto-generated, DO NOT edit manually
├── scripts/
│   └── build-snapshot.js             # Indexer (runs in Action)
└── .github/
    └── workflows/
        └── snapshot.yml              # Action definition
```

## One-time setup

1. **Add the API key as a GitHub Secret:**
   - Go to your repo `Settings → Secrets and variables → Actions`
   - Click `New repository secret`
   - Name: `CRONOS_API_KEY`
   - Value: `JhU1OvkEIUYYcBCnlfahIcPeu6DIGt7k`
   - Save

2. **Enable Actions write permissions** (needed for the workflow to push commits):
   - `Settings → Actions → General → Workflow permissions`
   - Select `Read and write permissions`
   - Save

3. **Place the files in your repo:**
   - `season.html` at the root (replaces existing)
   - `scripts/build-snapshot.js` (new folder + file)
   - `.github/workflows/snapshot.yml` (new path)
   - `data/season.json` (initial empty placeholder)

4. **Commit + push.** The Action will run automatically within 5 minutes, or trigger it manually:
   - Go to `Actions` tab in your repo
   - Click `Build Season Snapshot`
   - Click `Run workflow → Run workflow`

5. **Verify:**
   - After the run completes (~30 sec), check `data/season.json` got committed
   - Open `season.html` on GitHub Pages — leaderboard, feed, jackpots should populate

## What's stored in season.json

```jsonc
{
  "updatedAt": 1712863200,                 // unix seconds
  "seasonStart": 1742428800,
  "seasonDays": 30,
  "market": {
    "price": 0.00489,                      // CTR/USD
    "change24h": 5.2,
    "volume24h": 12000,
    "liquidity": 45000,
    "buys24h": 23,
    "sells24h": 11
  },
  "stats": {
    "totalTrades": 1245,                   // since season start
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
      "bC": 1020000, "sC": 40800,          // buy/sell volume CTR
      "balC": 980000,                      // current CTR balance
      "aw": 0.95, "hb": 1.32,              // anti-wash, hold bonus
      "n": 18,                             // trade count
      "ft": 1742500000, "lt": 1712863000   // first/last trade timestamps
    }
  },
  "trades": [                              // last 100 for live feed
    { "h": "0x...", "t": 1712863200, "ty": "buy", "w": "0x...", "ctr": 1500, "usd": 7.35 }
  ],
  "jackpots": [                            // last 50 wins
    { "h": "0x...", "t": 1712860000, "w": "0x...", "tier": 0.50, "cn": "p50", "buy_usd": 25.0, "refund": 1.25 }
  ]
}
```

## How buys/sells are identified

A CTR transfer event matches one of:
- **Buy**: `from = LP_pair, to ≠ LP_pair` → trader is `to`
- **Sell**: `to = LP_pair, from ≠ LP_pair` → trader is `from`

Excluded addresses (router contracts, treasury, zero address, etc.) are filtered out so router-mediated trades land on the actual user wallet.

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

**To re-run the workflow manually:** `Actions → Build Season Snapshot → Run workflow`

**To debug locally:**
```bash
export CRONOS_API_KEY=JhU1...
node scripts/build-snapshot.js
cat data/season.json | head -30
```

**Troubleshooting:**
- Workflow fails with `permission denied`: Check step 2 (write permissions)
- `season.json` empty / old: Check Actions tab for failed runs
- Frontend says "Snapshot unavailable": The JSON didn't load. Check browser DevTools network tab.

**Costs:** Free. GitHub Actions free tier gives 2000 min/month for private repos and unlimited for public. Each run takes ~30 sec, so 5-min cron = 8640 min/month. **Make sure your repo is public** (GitHub Pages free + unlimited Actions minutes).

## Why not real-time?

A 5-minute snapshot is plenty for a 30-day leaderboard. Real-time would require:
- A backend server running 24/7 (cost)
- A WebSocket connection to Cronos (fragile)
- A database with state (complexity)

The snapshot model gets you 95% of the value at 0% of the cost.
