// ============================================================
// CTR Arena – Konfiguration
// ============================================================
// Alle projektspezifischen Einstellungen an einer Stelle.
// Nur hier anpassen, wenn sich Token/Chain/Explorer ändern.
// ============================================================

window.CTR_CONFIG = {
  // Token
  tokenName: "CTR",
  tokenFullName: "CTR Token",
  contractAddress: "0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC",

  // Fallback, falls die API kein tokenDecimal liefert (CRC-20 ist praktisch
  // immer 18, wird aber aus den Txns dynamisch überschrieben, sobald vorhanden).
  decimalsFallback: 18,

  // Cronos EVM (Mainnet)
  chainId: 25,
  chainName: "Cronos",
  nativeSymbol: "CRO",

  // Block-Explorer
  explorerBase: "https://cronoscan.com",
  explorerTx: "https://cronoscan.com/tx/",
  explorerAddress: "https://cronoscan.com/address/",
  explorerToken: "https://cronoscan.com/token/",

  // Cronoscan API (Etherscan-kompatibel, CORS aktiviert → GitHub-Pages-tauglich)
  // Ein API-Key ist optional. Ohne Key: ~1 req/5s rate limit – für eine
  // Demo-Tracker-Page ausreichend. Mit Key ins Feld unten eintragen.
  apiBase: "https://api.cronoscan.com/api",
  apiKey: "", // optional, z.B. "YOUR_CRONOSCAN_KEY"

  // UI
  txPageSize: 50,      // Wie viele Txns werden geladen
  refreshMs: 30000,    // Auto-Refresh in Millisekunden (0 = aus)
  volumeBuckets: 24,   // Anzahl Balken im Volumen-Chart (Stunden)
};
