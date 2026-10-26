# CTR Arena

Trading-Season-Leaderboards für Cronos-EVM-Token.
Reine Static-Site, ready für **GitHub Pages**. Keine Build-Pipeline, kein Server.

Die Seiten lesen **keine** API direkt. Ein GitHub-Actions-Indexer baut alle
5 Minuten fertige JSON-Snapshots nach `data/`, committet sie, und die Seiten
laden nur noch diese Dateien. Details zum Datenfluss: [`SETUP.md`](SETUP.md).

- **CTR Contract:** `0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC`
- **Datenquellen (nur im Indexer, nicht im Browser):**
  - Öffentliche Cronos-JSON-RPC-Endpoints (`eth_getLogs`, Balances) — kein API-Key
  - [DexScreener](https://dexscreener.com) für Preis/Volumen/Liquidität
- **Features:**
  - Live Leaderboard (Score, Buy-/Sell-Volumen, Anti-Wash, Hold-Bonus)
  - Live Trade Feed (letzte 100 Trades)
  - Tax Return Jackpot (deterministische Rolls pro Tx-Hash, letzte 50 Wins)
  - Season-Countdown, Prize Pool, Rewards-Verteilung
  - Auto-Reload des Snapshots alle 60s
  - Dark Crypto Style, responsive

## Seasons

Drei unabhängige Seasons, jede mit eigener Seite und eigenen Snapshot-Dateien:

| Season | Seite | Snapshot |
| --- | --- | --- |
| CTR | `index.html` (Site-Root) | `data/season.json` |
| CRAB | `CWK.html` | `data/season-crab.json` |
| SWEEP | `SWEEP.html` | `data/season-sweep.json` |

`index.html` ist der Root-Entrypoint — das ist, was GitHub Pages unter `/`
ausliefert. Jede Seite ist self-contained: eigenes Inline-CSS und Inline-JS,
Logos aus dem Repo, extern geladen werden nur Google Fonts.

## Projektstruktur

```
.
├── index.html                    ← CTR Season (Root-Entrypoint)
├── CWK.html                      ← CRAB Season
├── SWEEP.html                    ← SWEEP Season
├── data/                         ← Auto-generiert, nicht manuell editieren
│   ├── season.json               ← Frontend-Snapshot
│   ├── season-crab.json
│   ├── season-sweep.json
│   ├── trades.json               ← Indexer-State (Trades + Block-Cursor)
│   ├── trades-crab.json
│   └── trades-sweep.json
├── scripts/
│   ├── build-snapshot.js         ← Indexer CTR
│   ├── build-snapshot-crab.js    ← Indexer CRAB
│   ├── build-snapshot-sweep.js   ← Indexer SWEEP
│   └── lib/snapshot-core.js      ← Log-Fetching, JSON-Store, Cursor-Logik
├── test/snapshot-core.test.js    ← node:test Suite
├── .github/workflows/            ← snapshot.yml, snapshot-crab.yml, snapshot-sweep.yml
├── assets/
│   ├── js/config.js              ← Legacy, s. unten
│   ├── js/app.js                 ← Legacy, s. unten
│   └── css/style.css             ← Legacy, s. unten
├── README.md
└── SETUP.md
```

### Legacy: `config.js`, `app.js`, `style.css`

`assets/js/config.js`, `assets/js/app.js` und `assets/css/style.css` stammen vom
früheren client-seitigen Cronoscan-Tracker und werden von **keiner** Seite mehr
geladen. Sie sind weiterhin im Repo, haben aber keine Wirkung auf die Site:
Änderungen an `config.js` (inkl. `contractAddress`, `apiKey`, `refreshMs`)
ändern nichts am Verhalten von `index.html`, `CWK.html` oder `SWEEP.html`.

Konfiguriert wird stattdessen oben in den Builder-Skripten (Contract, LP-Pair,
Season-Start, Season-Dauer, Jackpot-Tiers) bzw. in den Konstanten der jeweiligen
HTML-Seite.

`apiKey` in `config.js` ist leer und muss es bleiben — ein dort eingetragener Key
wäre öffentlich einsehbar. Für den Indexer wird kein Key benötigt.

## Lokal testen

Static-Server starten (wegen `fetch` auf `data/*.json` nicht per `file://` öffnen):

```bash
# Python
python3 -m http.server 8080

# oder Node
npx serve .
```

Dann `http://localhost:8080` öffnen. Es werden die eingecheckten Snapshots aus
`data/` angezeigt — zum Neuaufbau siehe `SETUP.md`.

Skripte prüfen:

```bash
node --check scripts/build-snapshot.js
node --test test/snapshot-core.test.js
```

## Deploy auf GitHub Pages

**Settings → Pages:**
- *Source:* **Deploy from a branch**
- *Branch:* `main` / `/ (root)`
- Save

Zusätzlich braucht es **Settings → Actions → General → Workflow permissions →
Read and write permissions**, damit die Snapshot-Workflows ihre Commits pushen
können. Die Seite ist dann live unter `https://<user>.github.io/<repo>/`.

Hinweis: Die drei Snapshot-Workflows pushen alle 5 Minuten nach `main`. Lokale
Arbeit also rebasen statt auf einen stabilen Tip zu setzen.

### Eigene Domain

Unter *Settings → Pages → Custom domain* eintragen und beim DNS einen `CNAME`
auf `<user>.github.io` setzen. Aktuell ist keine Custom Domain konfiguriert
(keine `CNAME`-Datei im Repo).

## Lizenz

MIT. Nicht finanzberatend – die Seite zeigt rohe On-Chain-Daten.
