// ============================================================
// CTR Arena – Konfiguration
// ============================================================

window.CTR_CONFIG = {
  // Token
  tokenName: "CTR",
  tokenFullName: "CTR Token",
  contractAddress: "0xF3672F0cF2E45B28AC4a1D50FD8aC2eB555c21FC",

  // Fallback decimals (overridden dynamically from API response)
  decimalsFallback: 18,

  // Cronos EVM Mainnet
  chainId: 25,
  chainName: "Cronos",
  nativeSymbol: "CRO",

  // Public Cronos JSON-RPC (used for DEX pair discovery via ethers.js)
  rpcUrl: "https://evm.cronos.org",

  // Uniswap-V2-style factory contracts on Cronos
  // Used to auto-discover CTR LP pair addresses
  dexFactories: [
    { name: "VVS Finance",  address: "0x3B44B2a187a7b3824131F8db5a74194D0a42Fc15" },
    { name: "MM Finance",   address: "0xd590cC180601AEcD6eeADD9B7f2B7611519544f4" },
    { name: "CronaSwap",    address: "0x73A48f8f521EB31c55c0e1274dB0898dE599Cb11" },
  ],

  // Quote tokens to pair against CTR when probing factories
  quoteTokens: [
    { address: "0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23", symbol: "WCRO"  },
    { address: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59", symbol: "USDC"  },
    { address: "0x66e428c3f67a68878562e79A0234c1F83c208770", symbol: "USDT"  },
    { address: "0xe44Fd7fCb2b1581822D0c862B68222998a0c299a", symbol: "WETH"  },
  ],

  // Known DEX router addresses (secondary buy/sell signal)
  dexRouters: [
    "0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae", // VVS Finance Router
    "0x145677FC4d9b8F19B5D56d1820c48e0443049a30", // MM Finance Router
  ],

  // Block-Explorer
  explorerBase:    "https://cronoscan.com",
  explorerTx:      "https://cronoscan.com/tx/",
  explorerAddress: "https://cronoscan.com/address/",
  explorerToken:   "https://cronoscan.com/token/",

  // Cronoscan API (Etherscan-compatible, CORS enabled – works on GitHub Pages)
  apiBase: "https://api.cronoscan.com/api",
  apiKey:  "", // optional – paste your key here to avoid rate-limits

  // UI
  txPageSize:    100,   // transfers to load per refresh
  refreshMs:   30000,   // auto-refresh interval (0 = off)
  volumeBuckets:  24,   // hourly bars in the chart
};
