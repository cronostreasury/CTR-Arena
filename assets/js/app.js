// ============================================================
// CTR Arena – App Logic
// ============================================================
// Holt Token-Daten von der Cronoscan API (Etherscan-kompatibel),
// rendert Stats, Volumen-Chart und eine Live-Tabelle.
// Rein client-side → GitHub-Pages-tauglich.
// ============================================================

(function () {
  "use strict";

  const CFG = window.CTR_CONFIG;
  if (!CFG) {
    console.error("CTR_CONFIG missing – check config.js load order");
    return;
  }

  // --- DOM helpers -----------------------------------------
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

  // --- Formatting ------------------------------------------
  const shortAddr = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
  const shortHash = (h) => h ? h.slice(0, 10) + "…" + h.slice(-6) : "";

  function fromUnits(valueStr, decimals) {
    // BigInt-basierte Division mit festem Nachkommateil (keine float-Fehler)
    try {
      const v = BigInt(valueStr || "0");
      const d = BigInt(decimals);
      const base = 10n ** d;
      const whole = v / base;
      const frac  = v % base;
      const fracStr = frac.toString().padStart(Number(d), "0").slice(0, 6).replace(/0+$/, "");
      return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
    } catch {
      return "0";
    }
  }

  function formatNumber(num, opts = {}) {
    const n = Number(num);
    if (!isFinite(n)) return "–";
    const { compact = false, max = 2 } = opts;
    if (compact && Math.abs(n) >= 1000) {
      return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: max,
      }).format(n);
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

  // --- API wrapper -----------------------------------------
  async function api(params) {
    const url = new URL(CFG.apiBase);
    for (const k in params) url.searchParams.set(k, params[k]);
    if (CFG.apiKey) url.searchParams.set("apikey", CFG.apiKey);
    const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Cronoscan liefert status: "0" bei "No transactions found" – das ist kein Fehler
    if (data.status === "0" && data.message !== "No transactions found") {
      throw new Error(data.result || data.message || "API error");
    }
    return data;
  }

  async function fetchTokenTx(page = 1, offset = CFG.txPageSize) {
    const data = await api({
      module: "account",
      action: "tokentx",
      contractaddress: CFG.contractAddress,
      page,
      offset,
      sort: "desc",
    });
    return Array.isArray(data.result) ? data.result : [];
  }

  async function fetchTokenSupply() {
    const data = await api({
      module: "stats",
      action: "tokensupply",
      contractaddress: CFG.contractAddress,
    });
    return data.result || "0";
  }

  // --- State ------------------------------------------------
  const state = {
    txns: [],
    decimals: CFG.decimalsFallback,
    supplyRaw: "0",
    filter: "",
    chart: null,
    lastRefresh: null,
  };

  // --- Render: Stats ---------------------------------------
  function computeStats() {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - 86400;
    const tx24 = state.txns.filter(t => Number(t.timeStamp) >= cutoff);

    let volume = 0n;
    const addrs = new Set();
    for (const t of tx24) {
      try { volume += BigInt(t.value); } catch {}
      addrs.add((t.from || "").toLowerCase());
      addrs.add((t.to || "").toLowerCase());
    }

    const supplyFmt = fromUnits(state.supplyRaw, state.decimals);
    const volumeFmt = fromUnits(volume.toString(), state.decimals);

    $("#stat-supply").textContent = formatNumber(supplyFmt, { compact: true, max: 2 });
    $("#stat-tx24").textContent = formatNumber(tx24.length);
    $("#stat-volume").textContent = formatNumber(volumeFmt, { compact: true, max: 2 });
    $("#stat-wallets").textContent = formatNumber(addrs.size);

    $("#stat-supply-sub").textContent = `${CFG.tokenName} total supply`;
    $("#stat-tx24-sub").textContent = `Transfers in the last 24h`;
    $("#stat-volume-sub").textContent = `${CFG.tokenName} moved in 24h`;
    $("#stat-wallets-sub").textContent = `Distinct addresses in 24h`;
  }

  // --- Render: Volume Chart --------------------------------
  function renderChart() {
    const ctx = document.getElementById("volume-chart");
    if (!ctx || typeof Chart === "undefined") return;

    const buckets = CFG.volumeBuckets;
    const now = Math.floor(Date.now() / 1000);
    const bucketSec = 3600;
    const start = now - buckets * bucketSec;

    const counts = new Array(buckets).fill(0);
    const volumes = new Array(buckets).fill(0);
    const dec = BigInt(state.decimals);
    const divisor = Number(10n ** dec);

    for (const t of state.txns) {
      const ts = Number(t.timeStamp);
      if (ts < start) continue;
      const idx = Math.min(buckets - 1, Math.floor((ts - start) / bucketSec));
      counts[idx]++;
      try {
        // approximativ (float) – nur für Anzeige im Chart, nicht für Total
        volumes[idx] += Number(BigInt(t.value)) / divisor;
      } catch {}
    }

    const labels = [];
    for (let i = 0; i < buckets; i++) {
      const d = new Date((start + i * bucketSec) * 1000);
      labels.push(d.getHours().toString().padStart(2, "0") + ":00");
    }

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = volumes;
      state.chart.data.datasets[1].data = counts;
      state.chart.update("none");
      return;
    }

    state.chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: `${CFG.tokenName} volume`,
            data: volumes,
            backgroundColor: "rgba(0, 229, 168, 0.55)",
            borderColor: "rgba(0, 229, 168, 1)",
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: "y",
          },
          {
            label: "Tx count",
            data: counts,
            type: "line",
            borderColor: "rgba(58, 160, 255, 1)",
            backgroundColor: "rgba(58, 160, 255, 0.15)",
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
            ticks: { color: "#5a6a84", font: { family: "ui-monospace, Menlo", size: 10 } },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
          y: {
            position: "left",
            ticks: { color: "#5a6a84", font: { family: "ui-monospace, Menlo", size: 10 } },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
          y1: {
            position: "right",
            ticks: { color: "#5a6a84", font: { family: "ui-monospace, Menlo", size: 10 } },
            grid: { display: false },
          },
        },
      },
    });
  }

  // --- Render: Transactions table --------------------------
  function renderTxns() {
    const tbody = $("#tx-body");
    const filter = state.filter.trim().toLowerCase();
    const rows = state.txns.filter(t => {
      if (!filter) return true;
      return (t.from || "").toLowerCase().includes(filter)
          || (t.to || "").toLowerCase().includes(filter)
          || (t.hash || "").toLowerCase().includes(filter);
    });

    tbody.innerHTML = "";
    if (rows.length === 0) {
      tbody.appendChild(el("tr", {}, el("td", { class: "empty", colspan: "6" }, "Keine Transaktionen gefunden.")));
      $("#tx-count").textContent = "0";
      return;
    }

    for (const t of rows) {
      const dec = Number(t.tokenDecimal || state.decimals);
      const amount = fromUnits(t.value, dec);
      let dir = "transfer";
      if (filter && (t.from || "").toLowerCase() === filter) dir = "out";
      else if (filter && (t.to || "").toLowerCase() === filter) dir = "in";
      if (filter && t.from?.toLowerCase() === filter && t.to?.toLowerCase() === filter) dir = "self";

      const tr = el("tr", {},
        el("td", { class: "col-hash" },
          el("a", { class: "hash", href: CFG.explorerTx + t.hash, target: "_blank", rel: "noopener" },
            el("span", { class: "short" }, shortHash(t.hash))
          )
        ),
        el("td", { class: "col-block mono", style: "color:var(--text-dim)" }, "#" + t.blockNumber),
        el("td", { class: "col-time", title: new Date(Number(t.timeStamp) * 1000).toISOString() }, formatAge(t.timeStamp)),
        el("td", { class: "col-from" },
          el("a", { class: "addr", href: CFG.explorerAddress + t.from, target: "_blank", rel: "noopener" },
            el("span", { class: "short" }, shortAddr(t.from))
          )
        ),
        el("td", { class: "col-to" },
          el("a", { class: "addr", href: CFG.explorerAddress + t.to, target: "_blank", rel: "noopener" },
            el("span", { class: "short" }, shortAddr(t.to))
          ),
          filter ? el("span", { class: "badge " + dir, style: "margin-left:8px" }, dir.toUpperCase()) : null
        ),
        el("td", { class: "amount" }, `${formatNumber(amount, { max: 4 })} `,
          el("span", { style: "color:var(--text-mute);font-weight:400" }, CFG.tokenName)
        ),
      );
      tbody.appendChild(tr);
    }

    $("#tx-count").textContent = formatNumber(rows.length);
  }

  // --- Loaders ---------------------------------------------
  async function loadAll() {
    const statusEl = $("#status");
    statusEl.innerHTML = `<span class="spinner"></span>syncing…`;

    try {
      const [txns, supply] = await Promise.all([
        fetchTokenTx(1, CFG.txPageSize),
        fetchTokenSupply().catch(() => "0"),
      ]);
      state.txns = txns;
      state.supplyRaw = supply;
      if (txns.length && txns[0].tokenDecimal) {
        state.decimals = Number(txns[0].tokenDecimal);
      }
      state.lastRefresh = new Date();

      computeStats();
      renderChart();
      renderTxns();

      statusEl.innerHTML = `<span class="dot"></span>live · updated ${state.lastRefresh.toLocaleTimeString()}`;
    } catch (err) {
      console.error(err);
      statusEl.innerHTML = `<span class="dot" style="background:var(--danger);box-shadow:0 0 8px var(--danger)"></span>API error`;
      $("#tx-body").innerHTML = `<tr><td colspan="6" class="error">Konnte Cronoscan API nicht erreichen: ${err.message}</td></tr>`;
    }
  }

  // --- Wire-up ---------------------------------------------
  function initHeader() {
    $("#contract-display").textContent = shortAddr(CFG.contractAddress);
    $("#contract-link").href = CFG.explorerToken + CFG.contractAddress;
    $("#explorer-link").href = CFG.explorerToken + CFG.contractAddress;
    $("#copy-addr").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(CFG.contractAddress);
        showToast("Contract-Adresse kopiert");
      } catch {
        showToast("Kopieren fehlgeschlagen");
      }
    });
    $("#refresh-btn").addEventListener("click", loadAll);

    const search = $("#search-input");
    search.addEventListener("input", (e) => {
      state.filter = e.target.value || "";
      renderTxns();
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
    // Age-Spalte in der Tabelle live mit-tickern
    setInterval(() => {
      $$(".col-time").forEach((td, i) => {
        const tx = state.txns[i];
        if (tx) td.textContent = formatAge(tx.timeStamp);
      });
    }, 15000);
  });
})();
