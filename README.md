# CTR Arena

Live Transaction Tracker für den **CTR Token** auf **Cronos EVM**.
Reine Static-Site, ready für **GitHub Pages**. Keine Build-Pipeline, kein Server.

- **Contract:** `0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC`
- **Datenquelle:** [Cronoscan API](https://cronoscan.com) (Etherscan-kompatibel, CORS-fähig)
- **Features:**
  - Live Stats: Total Supply · 24h Transfers · 24h Volume · Active Wallets
  - Stündliches Volumen- & Tx-Count-Chart (Chart.js)
  - Recent-Transfers-Tabelle mit Adress-/Hash-Filter
  - Auto-Refresh (Default: alle 30s)
  - Dark Crypto Style, responsive

## Projektstruktur

```
.
├── index.html
├── assets/
│   ├── css/style.css
│   └── js/
│       ├── config.js   ← Contract-Adresse & API-Key
│       └── app.js      ← gesamte Logik
└── README.md
```

## Lokal testen

Einfach einen Static-Server starten (damit `fetch` zur API relativ normal funktioniert):

```bash
# Python
python3 -m http.server 8080

# oder Node
npx serve .
```

Dann `http://localhost:8080` öffnen.

## Deploy auf GitHub Pages

1. Neues Repo erstellen, z.B. `ctr-arena`.
2. Dateien pushen:
   ```bash
   git init
   git add .
   git commit -m "init CTR Arena"
   git branch -M main
   git remote add origin git@github.com:<user>/ctr-arena.git
   git push -u origin main
   ```
3. Auf GitHub → **Settings → Pages**:
   - *Source:* **Deploy from a branch**
   - *Branch:* `main` / `/ (root)`
   - Save.
4. Nach ein paar Sekunden ist die Seite live unter
   `https://<user>.github.io/ctr-arena/`.

### Eigene Domain

Unter *Settings → Pages → Custom domain* eintragen (z.B. `arena.ctrtoken.xyz`)
und bei deinem DNS einen `CNAME` auf `<user>.github.io` setzen.

## Konfiguration

Alles Wichtige steckt in [`assets/js/config.js`](assets/js/config.js):

| Key | Default | Zweck |
| --- | --- | --- |
| `contractAddress` | CTR-Adresse | Wenn sich der Contract ändert: hier ersetzen |
| `apiKey` | `""` | Optionaler Cronoscan API-Key (höheres Rate-Limit) |
| `txPageSize` | `50` | Anzahl der geladenen Transfers |
| `refreshMs` | `30000` | Auto-Refresh Intervall (0 = aus) |
| `volumeBuckets` | `24` | Stunden-Balken im Chart |

### API-Key (optional)

Ohne Key funktioniert die Seite, ist aber auf ~1 Request / 5s limitiert.
Einen kostenlosen Key bekommst du auf [cronoscan.com/apis](https://cronoscan.com/apis).
Trage ihn in `config.js` bei `apiKey` ein. **Wichtig:** Der Key liegt
client-seitig und ist damit öffentlich einsehbar – nutze daher nur einen
Free-Tier-Key, der nur für diese Seite gedacht ist.

## Erweitern

Ein paar naheliegende nächste Schritte:

- **Holder-Liste:** `module=token&action=tokenholderlist` (Cronoscan Pro)
- **Preis / Marktdaten:** z.B. VVS Finance oder Dexscreener Subgraph
- **Top-Wallets:** Aggregation über `tokentx` (Netto-Bilanzen)
- **Pagination:** `page`-Parameter in `fetchTokenTx` durchschleifen
- **Wallet-Detail-View:** neue Route `?address=0x…` + Filter auf Txns

## Lizenz

MIT. Nicht finanzberatend – die Seite zeigt rohe On-Chain-Daten.
