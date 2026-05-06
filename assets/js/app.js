// ============================================================
// CTR Arena – App Logic
// ============================================================

(function () {
  "use strict";

  const CFG = window.CTR_CONFIG;
  if (!CFG) { console.error("CTR_CONFIG missing"); return; }

  // ── DOM helpers ──────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  };

  // ── Formatting ────────────────────────────────────────────
  const shortAddr = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
  const shortHash = (h) => h ? h.slice(0, 10) + "…" + h.slice(-6) : "";

  function fromUnits(valueStr, decimals) {
    try {
      const v = BigInt(valueStr || "0");
      const d = BigInt(decimals);
      const base = 10n ** d;
      const whole = v / base;
      const frac  = v % base;
      const fracStr = frac.toString().padStart(Number(d), "0").slice(0, 6).replace(/0+$/, "");
      return fracStr ? `${whole}.${fracStr}` : whole.toString();
    } catch { return "0"; }
  }

  function formatNumber(num, opts = {}) {
    const n = Number(num);
    if (!isFinite(n)) return "–";
    const { compact = false, max = 2 } = opts;
    if (compact && Math.abs(n) >= 1000) {
      return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: max }).format(n);
    }
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(n);
  }

  function formatAge(unixSec) {
    const diff = Math.max(0, Date.now() / 1000 - Number(unixSec));
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  // ── Cronoscan API ─────────────────────────────────────────
  async function api(params) {
    const url = new URL(CFG.apiBase);
    for (const k in params) url.searchParams.set(k, params[k]);
    if (CFG.apiKey) url.searchParams.set("apikey", CFG.apiKey);
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === "0" && data.message !== "No transactions found") {
      throw new Error(data.result || data.message || "API error");
    }
    return data;
  }

  async function fetchTokenTx(page = 1, offset = CFG.txPageSize) {
    const data = await api({
      module: "account", action: "tokentx",
      contractaddress: CFG.contractAddress,
      page, offset, sort: "desc",
    });
    return Array.isArray(data.result) ? data.result : [];
  }

  async function fetchTokenSupply() {
    const data = await api({
      module: "stats", action: "tokensupply",
      contractaddress: CFG.contractAddress,
    });
    return data.result || "0";
  }

  // ── DEX Pair Discovery (ethers.js) ────────────────────────
  const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
  const ZERO_ADDR   = "0x0000000000000000000000000000000000000000";

  async function discoverPairsOnChain() {
    if (!window.ethers) return new Set();
    const discovered = new Set();
    try {
      const provider = new ethers.providers.JsonRpcProvider(CFG.rpcUrl);
      for (const factory of (CFG.dexFactories || [])) {
        const contract = new ethers.Contract(factory.address, FACTORY_ABI, provider);
        for (const quote of (CFG.quoteTokens || [])) {
          try {
            const pair = await Promise.race([
              contract.getPair(CFG.contractAddress, quote.address),
              new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
            ]);
            if (pair && pair.toLowerCase() !== ZERO_ADDR) {
              discovered.add(pair.toLowerCase());
              console.log(`[CTR] Pair found: ${factory.name} CTR/${quote.symbol} → ${pair}`);
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn("[CTR] On-chain pair discovery failed:", err.message);
    }
    return discovered;
  }

  // Heuristic: addresses appearing frequently on BOTH sides of transfers
  // are almost certainly LP pair contracts (pairs both buy and sell CTR).
  function heuristicPairsFromTxns(txns, threshold = 3) {
    const fromCount = {}, toCount = {};
    for (const t of txns) {
      const f = (t.from || "").toLowerCase();
      const to = (t.to || "").toLowerCase();
      fromCount[f] = (fromCount[f] || 0) + 1;
      toCount[to]  = (toCount[to]  || 0) + 1;
    }
    const pairs = new Set();
    const contract = CFG.contractAddress.toLowerCase();
    for (const addr of Object.keys(fromCount)) {
      if (addr === contract) continue;
      if (fromCount[addr] >= threshold && toCount[addr] >= threshold) {
        pairs.add(addr);
      }
    }
    return pairs;
  }

  // ── TX Classification ─────────────────────────────────────
  // BUY  = CTR flows FROM a pair TO a wallet (pair sent CTR to buyer)
  // SELL = CTR flows FROM a wallet TO a pair (wallet sent CTR to pair)
  function classifyTx(tx, pairs) {
    const from = (tx.from || "").toLowerCase();
    const to   = (tx.to   || "").toLowerCase();
    if (pairs.has(from)) return "buy";
    if (pairs.has(to))   return "sell";
    const routers = state.routerSet;
    if (routers.has(from)) return "buy";
    if (routers.has(to))   return "sell";
    return "transfer";
  }

  // ── State ─────────────────────────────────────────────────
  const state = {
    txns:        [],
    decimals:    CFG.decimalsFallback,
    supplyRaw:   "0",
    pairs:       new Set(),
    routerSet:   new Set((CFG.dexRouters || []).map(a => a.toLowerCase())),
    typeFilter:  "all",  // 'all' | 'buy' | 'sell' | 'transfer'
    addrFilter:  "",
    chart:       null,
    lastRefresh: null,
    pairsReady:  false,
  };

  // ── Render: Stats ─────────────────────────────────────────
  function computeStats() {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - 86400;
    const tx24 = state.txns.filter(t => Number(t.timeStamp) >= cutoff);

    let volume = 0n, buys = 0, sells = 0;
    for (const t of tx24) {
      try { volume += BigInt(t.value); } catch {}
      const type = classifyTx(t, state.pairs);
      if (type === "buy")  buys++;
      if (type === "sell") sells++;
    }

    const supplyFmt = fromUnits(state.supplyRaw, state.decimals);
    const volFmt    = fromUnits(volume.toString(), state.decimals);

    $("#stat-supply").textContent  = formatNumber(supplyFmt, { compact: true, max: 2 });
    $("#stat-buys").textContent    = formatNumber(buys);
    $("#stat-sells").textContent   = formatNumber(sells);
    $("#stat-volume").textContent  = formatNumber(volFmt, { compact: true, max: 2 });

    $("#stat-supply-sub").textContent = `${CFG.tokenName} total supply`;
    $("#stat-buys-sub").textContent   = `Buy swaps last 24h`;
    $("#stat-sells-sub").textContent  = `Sell swaps last 24h`;
    $("#stat-volume-sub").textContent = `${CFG.tokenName} moved in 24h`;

    // Buy/Sell ratio bar
    const total = buys + sells;
    if (total > 0) {
      const pct = Math.round((buys / total) * 100);
      const bar = $("#buysell-bar");
      if (bar) {
        bar.style.setProperty("--buy-pct", pct + "%");
        bar.querySelector(".buysell-label-buy").textContent  = `${pct}% Buy`;
        bar.querySelector(".buysell-label-sell").textContent = `${100 - pct}% Sell`;
        bar.style.display = "flex";
      }
    }
  }

  // ── Render: Chart ─────────────────────────────────────────
  function renderChart() {
    const ctx = document.getElementById("volume-chart");
    if (!ctx || typeof Chart === "undefined") return;

    const buckets   = CFG.volumeBuckets;
    const now       = Math.floor(Date.now() / 1000);
    const bucketSec = 3600;
    const start     = now - buckets * bucketSec;
    const dec       = BigInt(state.decimals);
    const divisor   = Number(10n ** dec);

    const buyVols  = new Array(buckets).fill(0);
    const sellVols = new Array(buckets).fill(0);
    const txCounts = new Array(buckets).fill(0);

    for (const t of state.txns) {
      const ts = Number(t.timeStamp);
      if (ts < start) continue;
      const idx  = Math.min(buckets - 1, Math.floor((ts - start) / bucketSec));
      const type = classifyTx(t, state.pairs);
      const val  = Number(BigInt(t.value)) / divisor;
      txCounts[idx]++;
      if (type === "buy")  buyVols[idx]  += val;
      if (type === "sell") sellVols[idx] += val;
    }

    const labels = [];
    for (let i = 0; i < buckets; i++) {
      const d = new Date((start + i * bucketSec) * 1000);
      labels.push(d.getHours().toString().padStart(2, "0") + ":00");
    }

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = buyVols;
      state.chart.data.datasets[1].data = sellVols;
      state.chart.data.datasets[2].data = txCounts;
      state.chart.update("none");
      return;
    }

    state.chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Buy Volume (CTR)",
            data: buyVols,
            backgroundColor: "rgba(0, 229, 168, 0.55)",
            borderColor: "rgba(0, 229, 168, 1)",
            borderWidth: 1,
            borderRadius: 3,
            stack: "vol",
            yAxisID: "y",
          },
          {
            label: "Sell Volume (CTR)",
            data: sellVols,
            backgroundColor: "rgba(255, 90, 90, 0.55)",
            borderColor: "rgba(255, 90, 90, 1)",
            borderWidth: 1,
            borderRadius: 3,
            stack: "vol",
            yAxisID: "y",
          },
          {
            label: "Tx Count",
            data: txCounts,
            type: "line",
            borderColor: "rgba(58, 160, 255, 0.9)",
            backgroundColor: "rgba(58, 160, 255, 0.12)",
            pointRadius: 0,
            tension: 0.35,
            borderWidth: 2,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: "#8a99b3", font: { family: "ui-monospace, Menlo", size: 11 } },
          },
          tooltip: {
            backgroundColor: "#111723",
            borderColor: "#2a3a55",
            borderWidth: 1,
            titleColor: "#e6edf7",
            bodyColor: "#e6edf7",
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: "#5a6a84", font: { family: "ui-monospace, Menlo", size: 10 } },
            grid:  { color: "rgba(255,255,255,0.04)" },
          },
          y: {
            stacked: true,
            position: "left",
            ticks: { color: "#5a6a84", font: { family: "ui-monospace, Menlo", size: 10 } },
            grid:  { color: "rgba(255,255,255,0.04)" },
          },
          y1: {
            position: "right",
            ticks: { color: "#5a6a84", font: { family: "ui-monospace, Menlo", size: 10 } },
            grid:  { display: false },
          },
        },
      },
    });
  }

  // ── Render: Transactions Table ────────────────────────────
  function renderTxns() {
    const tbody = $("#tx-body");
    const addrF = state.addrFilter.trim().toLowerCase();
    const typeF = state.typeFilter;

    const rows = state.txns.filter(t => {
      const type = classifyTx(t, state.pairs);
      if (typeF !== "all" && type !== typeF) return false;
      if (!addrF) return true;
      return (t.from || "").toLowerCase().includes(addrF)
          || (t.to   || "").toLowerCase().includes(addrF)
          || (t.hash || "").toLowerCase().includes(addrF);
    });

    tbody.innerHTML = "";
    if (rows.length === 0) {
      tbody.appendChild(el("tr", {}, el("td", { class: "empty", colspan: "7" }, "No transactions found.")));
      $("#tx-count").textContent = "0";
      return;
    }

    const TYPE_META = {
      buy:      { label: "BUY",      cls: "badge-buy"      },
      sell:     { label: "SELL",     cls: "badge-sell"      },
      transfer: { label: "TRANSFER", cls: "badge-transfer"  },
    };

    for (const t of rows) {
      const dec    = Number(t.tokenDecimal || state.decimals);
      const amount = fromUnits(t.value, dec);
      const type   = classifyTx(t, state.pairs);
      const meta   = TYPE_META[type];

      const tr = el("tr", {},
        el("td", { class: "col-type" },
          el("span", { class: `badge ${meta.cls}` }, meta.label)
        ),
        el("td", { class: "col-hash" },
          el("a", { class: "hash", href: CFG.explorerTx + t.hash, target: "_blank", rel: "noopener" },
            el("span", { class: "short" }, shortHash(t.hash))
          )
        ),
        el("td", { class: "col-block mono", style: "color:var(--text-dim)" }, "#" + t.blockNumber),
        el("td", { class: "col-time", title: new Date(Number(t.timeStamp) * 1000).toISOString() },
          formatAge(t.timeStamp)
        ),
        el("td", { class: "col-from" },
          el("a", { class: "addr", href: CFG.explorerAddress + t.from, target: "_blank", rel: "noopener" },
            el("span", { class: "short" }, shortAddr(t.from))
          )
        ),
        el("td", { class: "col-to" },
          el("a", { class: "addr", href: CFG.explorerAddress + t.to, target: "_blank", rel: "noopener" },
            el("span", { class: "short" }, shortAddr(t.to))
          )
        ),
        el("td", { class: "amount" },
          `${formatNumber(amount, { max: 4 })} `,
          el("span", { style: "color:var(--text-mute);font-weight:400" }, CFG.tokenName)
        ),
      );

      // Click row → open tx on explorer
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => window.open(CFG.explorerTx + t.hash, "_blank", "noopener"));

      tbody.appendChild(tr);
    }

    $("#tx-count").textContent = formatNumber(rows.length);
  }

  // ── Pair Status Label ────────────────────────────────────
  function updatePairStatus() {
    const el = $("#pair-status");
    if (!el) return;
    if (state.pairs.size === 0) {
      el.textContent = "No DEX pairs found";
      el.style.color = "var(--text-mute)";
    } else {
      el.textContent = `${state.pairs.size} DEX pair${state.pairs.size > 1 ? "s" : ""} tracked`;
      el.style.color = "var(--accent)";
    }
  }

  // ── Main Loader ───────────────────────────────────────────
  async function loadAll() {
    const statusEl = $("#status");
    statusEl.innerHTML = `<span class="spinner"></span>syncing…`;

    try {
      const [txns, supply] = await Promise.all([
        fetchTokenTx(1, CFG.txPageSize),
        fetchTokenSupply().catch(() => "0"),
      ]);

      state.txns      = txns;
      state.supplyRaw = supply;

      if (txns.length && txns[0].tokenDecimal) {
        state.decimals = Number(txns[0].tokenDecimal);
      }

      // Merge heuristic pairs with on-chain discovered pairs
      const heuristic = heuristicPairsFromTxns(txns, 3);
      for (const p of heuristic) state.pairs.add(p);

      state.lastRefresh = new Date();
      updatePairStatus();
      computeStats();
      renderChart();
      renderTxns();

      statusEl.innerHTML = `<span class="dot"></span>live · ${state.lastRefresh.toLocaleTimeString()}`;
    } catch (err) {
      console.error(err);
      statusEl.innerHTML = `<span class="dot" style="background:var(--danger);box-shadow:0 0 8px var(--danger)"></span>API error`;
      $("#tx-body").innerHTML = `<tr><td colspan="7" class="error">Could not reach Cronoscan API: ${err.message}</td></tr>`;
    }
  }

  // ── Init: On-chain pair discovery (runs once in background) ──
  async function initPairDiscovery() {
    const discovered = await discoverPairsOnChain();
    let added = 0;
    for (const p of discovered) {
      if (!state.pairs.has(p)) { state.pairs.add(p); added++; }
    }
    state.pairsReady = true;
    if (added > 0 && state.txns.length > 0) {
      // Re-render with freshly discovered pairs
      computeStats();
      renderChart();
      renderTxns();
    }
    updatePairStatus();
  }

  // ── Wire-up ───────────────────────────────────────────────
  function initHeader() {
    $("#contract-display").textContent = shortAddr(CFG.contractAddress);
    $("#contract-link").href = CFG.explorerToken + CFG.contractAddress;
    $("#explorer-link").href = CFG.explorerToken + CFG.contractAddress;

    $("#copy-addr").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(CFG.contractAddress);
        showToast("Contract address copied");
      } catch { showToast("Copy failed"); }
    });

    $("#refresh-btn").addEventListener("click", loadAll);

    // Address search
    $("#search-input").addEventListener("input", (e) => {
      state.addrFilter = e.target.value || "";
      renderTxns();
    });

    // Type filter buttons
    $$(".type-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        $$(".type-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.typeFilter = btn.dataset.filter;
        renderTxns();
      });
    });
  }

  let toastTimer;
  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  function startAutoRefresh() {
    if (!CFG.refreshMs) return;
    setInterval(loadAll, CFG.refreshMs);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initHeader();
    loadAll();
    startAutoRefresh();
    initPairDiscovery(); // runs concurrently, re-renders when ready

    // Live-tick the age column
    setInterval(() => {
      $$(".col-time").forEach((td, i) => {
        const filtered = state.txns.filter(t => {
          const type = classifyTx(t, state.pairs);
          if (state.typeFilter !== "all" && type !== state.typeFilter) return false;
          if (!state.addrFilter) return true;
          const f = state.addrFilter.toLowerCase();
          return (t.from || "").toLowerCase().includes(f)
              || (t.to   || "").toLowerCase().includes(f)
              || (t.hash || "").toLowerCase().includes(f);
        });
        if (filtered[i]) td.textContent = formatAge(filtered[i].timeStamp);
      });
    }, 15000);
  });
})();
