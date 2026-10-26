/**
 * Shared snapshot-freshness and market-value state rules.
 *
 * Loaded both as a plain browser script (window.MarketState) by index.html /
 * CWK.html / SWEEP.html and as a CommonJS module by test/market-state.test.js,
 * so the pages and the tests exercise one implementation.
 *
 * Two rules this file exists to enforce:
 *
 *  1. A snapshot older than MAX_FRESH_AGE_SEC is never presented as LIVE.
 *     The builders run on GitHub Actions `schedule:`, whose delivery is
 *     best-effort, so the page cannot assume the declared cron cadence held.
 *
 *  2. A missing or invalid metric is not the number zero. `num()` keeps a real
 *     0 from the source and maps everything unusable to null, and the
 *     formatters render null as PLACEHOLDER instead of "$0.00" / "0%".
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Beyond 15 minutes a snapshot is stale regardless of what the cron claims.
  var MAX_FRESH_AGE_SEC = 900;
  // Shown wherever a value is missing or invalid, so it cannot read as a real figure.
  var PLACEHOLDER = '--';

  /**
   * Validate a value coming from snapshot JSON or a market API.
   * Returns the number when it is genuinely numeric (including 0), else null.
   * Deliberately rejects '', booleans, NaN and Infinity, all of which `||  0`
   * or `Number()` would otherwise quietly turn into a displayable zero.
   */
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    var s = v.trim();
    if (!s) return null;
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** True when `v` is a usable value rather than missing/invalid source data. */
  function isPresent(v) {
    return num(v) !== null;
  }

  /** "45s" / "12m" / "3h" / "2d" for a non-negative age in seconds. */
  function humanAge(ageSec) {
    if (ageSec < 60) return Math.floor(ageSec) + 's';
    if (ageSec < 3600) return Math.floor(ageSec / 60) + 'm';
    if (ageSec < 86400) return Math.floor(ageSec / 3600) + 'h';
    return Math.floor(ageSec / 86400) + 'd';
  }

  /**
   * Classify a snapshot's `updatedAt` (unix seconds).
   *
   *   unavailable — no usable timestamp; nothing about age can be claimed
   *   fresh       — age <= MAX_FRESH_AGE_SEC; the only state allowed to say LIVE
   *   stale       — older than that
   *
   * A timestamp slightly in the future (runner/browser clock skew) is clamped
   * to age 0 rather than treated as an error.
   */
  function freshness(updatedAt, nowSec) {
    var ts = num(updatedAt);
    var now = num(nowSec);
    if (now === null) now = Date.now() / 1000;
    if (ts === null || ts <= 0) {
      return { state: 'unavailable', ageSec: null, isLive: false, label: 'Snapshot unavailable' };
    }
    var ageSec = Math.max(0, now - ts);
    if (ageSec <= MAX_FRESH_AGE_SEC) {
      return {
        state: 'fresh',
        ageSec: ageSec,
        isLive: true,
        label: ageSec < 120 ? 'LIVE · just updated' : 'LIVE · ' + humanAge(ageSec) + ' ago'
      };
    }
    return {
      state: 'stale',
      ageSec: ageSec,
      isLive: false,
      label: 'STALE · ' + humanAge(ageSec) + ' old'
    };
  }

  /**
   * `$0.000007` — a real 0 renders as $0.000000, missing data as PLACEHOLDER.
   *
   * Prices below the 6-decimal floor switch to exponential rather than
   * flattening to "$0.000000": CRAB really trades around 2.3e-11, and rounding
   * a live price down to a displayed zero is the same class of bug as showing
   * missing data as zero.
   */
  function fmtPrice(v, dp) {
    var n = num(v);
    if (n === null) return PLACEHOLDER;
    var places = typeof dp === 'number' ? dp : 6;
    if (n !== 0 && Math.abs(n) < Math.pow(10, -places)) return '$' + n.toExponential(2);
    return '$' + n.toFixed(places);
  }

  /** `$1.23M` / `$4.5K` / `$12.34`, PLACEHOLDER when unavailable. */
  function fmtUsd(v) {
    var n = num(v);
    if (n === null) return PLACEHOLDER;
    var a = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + a.toFixed(2);
  }

  /** `+1.23%` / `-4.50%` / `+0.00%` for a real zero, PLACEHOLDER when unavailable. */
  function fmtPct(v) {
    var n = num(v);
    return n === null ? PLACEHOLDER : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  /** Thousands-separated integer, PLACEHOLDER when unavailable. */
  function fmtCount(v) {
    var n = num(v);
    return n === null ? PLACEHOLDER : Math.round(n).toLocaleString('en-US');
  }

  /** `1.23B` / `4.56M` / `7.8K` token amounts, PLACEHOLDER when unavailable. */
  function fmtCompact(v) {
    var n = num(v);
    if (n === null) return PLACEHOLDER;
    var a = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + 'K';
    return sign + a.toFixed(0);
  }

  /**
   * Normalise a snapshot `market` object into validated numbers-or-null, so
   * callers never have to guess whether a 0 came from the source or a fallback.
   */
  var MARKET_FIELDS = ['price', 'change24h', 'volume24h', 'liquidity', 'buys24h', 'sells24h'];
  function market(m) {
    var src = (m && typeof m === 'object') ? m : {};
    var out = {};
    for (var i = 0; i < MARKET_FIELDS.length; i++) {
      out[MARKET_FIELDS[i]] = num(src[MARKET_FIELDS[i]]);
    }
    return out;
  }

  return {
    MAX_FRESH_AGE_SEC: MAX_FRESH_AGE_SEC,
    PLACEHOLDER: PLACEHOLDER,
    MARKET_FIELDS: MARKET_FIELDS,
    num: num,
    isPresent: isPresent,
    humanAge: humanAge,
    freshness: freshness,
    fmtPrice: fmtPrice,
    fmtUsd: fmtUsd,
    fmtPct: fmtPct,
    fmtCount: fmtCount,
    fmtCompact: fmtCompact,
    market: market
  };
});
