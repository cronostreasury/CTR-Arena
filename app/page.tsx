'use client'

import { useEffect, useState, useCallback } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface Transaction {
  hash: string
  block: number
  type: 'BUY' | 'SELL' | 'TRANSFER'
  amount: number
  trader: string | null
  from: string
  to: string
  timestamp: number
}
interface Stats {
  total: number
  buyCount: number
  sellCount: number
  buyVolume: number
  sellVolume: number
  traders: number
  latestBlock: number
}
interface PriceData {
  price: number
  change24h: number
  volume24h: number
  liquidity: number
  mcap: number
}
type FilterType = 'ALL' | 'BUY' | 'SELL' | 'TRANSFER'

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
}
function fmtUSD(n: number): string {
  if (n <= 0)          return '--'
  if (n < 0.01)        return '<$0.01'
  if (n >= 1_000_000)  return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)      return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}
function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60)    return diff + 's ago'
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return Math.floor(diff / 86400) + 'd ago'
}
function short(addr: string | null): string {
  if (!addr) return '...'
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export default function Page() {
  const [txs, setTxs]           = useState<Transaction[]>([])
  const [stats, setStats]       = useState<Stats | null>(null)
  const [price, setPrice]       = useState<PriceData | null>(null)
  const [filter, setFilter]     = useState<FilterType>('ALL')
  const [loading, setLoading]   = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string>('')
  const [tick, setTick]         = useState(0)  // for timeAgo re-renders
  const [toast, setToast]       = useState<string>('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const fetchPrice = useCallback(async () => {
    try {
      const res  = await fetch('/api/price')
      const data = await res.json()
      if (!data.error) setPrice(data)
    } catch { /* silent */ }
  }, [])

  const fetchTxs = useCallback(async () => {
    try {
      const res  = await fetch('/api/transactions')
      const data = await res.json()
      if (data.error) { showToast('RPC error: ' + data.error.slice(0, 50)); return }
      setTxs(data.transactions || [])
      setStats(data.stats || null)
      setLastUpdate(new Date().toLocaleTimeString())
    } catch (e: unknown) {
      showToast('Fetch failed')
    }
  }, [])

  const refresh = useCallback(async () => {
    setSpinning(true)
    await Promise.all([fetchPrice(), fetchTxs()])
    setSpinning(false)
  }, [fetchPrice, fetchTxs])

  // initial load
  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  // auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  // tick for timeAgo updates
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  const filtered = filter === 'ALL' ? txs : txs.filter(t => t.type === filter)
  const p = price?.price ?? 0

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px 80px' }}>

      {/* ── HEADER ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 0 28px', borderBottom: '1px solid var(--border)',
        marginBottom: 28, flexWrap: 'wrap', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, background: 'var(--gold)', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12,
            color: '#060608', boxShadow: '0 0 20px var(--gold-glow)',
          }}>CTR</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>CTR Tracker</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
              Cronos Treasury Reserve // Live Feed
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          {/* extra market info */}
          {price && (
            <div style={{ display: 'flex', gap: 20, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted2)' }}>
              {price.mcap > 0 && (
                <span>MCap <strong style={{ color: 'var(--text)' }}>{fmtUSD(price.mcap)}</strong></span>
              )}
              {price.liquidity > 0 && (
                <span>Liq <strong style={{ color: 'var(--text)' }}>{fmtUSD(price.liquidity)}</strong></span>
              )}
            </div>
          )}

          {/* live dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted2)' }}>
            <LiveDot />
            LIVE
          </div>

          {/* price pill */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border2)',
            borderRadius: 30, padding: '8px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>CTR</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--gold)' }}>
              {p > 0 ? (p < 0.0001 ? `$${p.toFixed(8)}` : `$${p.toFixed(6)}`) : '--'}
            </span>
            {price && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: price.change24h >= 0 ? 'var(--green)' : 'var(--red)',
              }}>
                {price.change24h >= 0 ? '+' : ''}{price.change24h.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── STAT CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard accent="var(--gold)" label="Volume (24h)" value={stats ? fmt(stats.buyVolume + stats.sellVolume) + ' CTR' : '--'} sub={stats && p > 0 ? fmtUSD((stats.buyVolume + stats.sellVolume) * p) : '--'} />
        <StatCard accent="var(--green)" label="Buy Volume" value={stats ? fmt(stats.buyVolume) + ' CTR' : '--'} sub={stats ? stats.buyCount + ' buys' : '0 buys'} valueColor="var(--green)" />
        <StatCard accent="var(--red)" label="Sell Volume" value={stats ? fmt(stats.sellVolume) + ' CTR' : '--'} sub={stats ? stats.sellCount + ' sells' : '0 sells'} valueColor="var(--red)" />
        <StatCard accent="var(--blue)" label="Unique Traders" value={stats ? String(stats.traders) : '--'} sub={stats ? stats.total + ' transactions' : '0 transactions'} />
      </div>

      {/* ── TOOLBAR ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['ALL', 'BUY', 'SELL', 'TRANSFER'] as FilterType[]).map(f => (
            <FilterTab key={f} label={f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()} active={filter === f} type={f} onClick={() => setFilter(f)} />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastUpdate && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
              Updated {lastUpdate}
            </span>
          )}
          <button
            onClick={() => { setSpinning(true); refresh().finally(() => setSpinning(false)) }}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, padding: '7px 14px',
              borderRadius: 4, border: '1px solid var(--border2)', background: 'var(--surface)',
              color: 'var(--muted2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
              style={{ animation: spinning ? 'spin 0.8s linear infinite' : 'none' }}
            >
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── TABLE ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Time', 'Type', 'Amount', 'Value', 'Trader', 'TX Hash'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', textAlign: 'left',
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                    color: 'var(--muted)', letterSpacing: '1.5px', textTransform: 'uppercase',
                    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '60px 16px', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)' }}>
                    <span style={{ marginRight: 10 }}>Loading...</span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '60px 16px', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)' }}>
                    No {filter.toLowerCase()} transactions found
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 200).map(tx => (
                  <TxRow key={tx.hash} tx={tx} price={p} tick={tick} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop: '1px solid var(--border)', paddingTop: 20, marginTop: 40,
        display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
          Contract: <span style={{ color: 'var(--muted2)' }}>0xF367...21FC</span>
          &nbsp;|&nbsp; LP: <span style={{ color: 'var(--muted2)' }}>0xf118...4fb</span>
          &nbsp;|&nbsp; Network: <span style={{ color: 'var(--muted2)' }}>Cronos EVM</span>
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
          Data: <span style={{ color: 'var(--muted2)' }}>Cronos RPC</span>
          &nbsp;+&nbsp; <span style={{ color: 'var(--muted2)' }}>DexScreener</span>
        </span>
      </footer>

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 'var(--radius)', padding: '12px 20px',
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--gold)',
          zIndex: 100,
        }}>{toast}</div>
      )}

      {/* ── SPIN KEYFRAME ── */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes rowIn { from { opacity:0; transform:translateX(-4px); } to { opacity:1; transform:translateX(0); } }
      `}</style>
    </div>
  )
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function LiveDot() {
  return (
    <div style={{
      width: 8, height: 8, borderRadius: '50%', background: 'var(--green)',
      animation: 'pulse 2s infinite',
      boxShadow: '0 0 0 0 rgba(0,208,132,0.5)',
    }}>
      <style>{`
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 rgba(0,208,132,0.5); }
          70%  { box-shadow: 0 0 0 6px rgba(0,208,132,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,208,132,0); }
        }
      `}</style>
    </div>
  )
}

function StatCard({ accent, label, value, sub, valueColor }: {
  accent: string; label: string; value: string; sub: string; valueColor?: string
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '18px 20px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent }} />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -1, lineHeight: 1, color: valueColor ?? 'var(--text)' }}>
        {value}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted2)', marginTop: 6 }}>
        {sub}
      </div>
    </div>
  )
}

function FilterTab({ label, active, type, onClick }: {
  label: string; active: boolean; type: string; onClick: () => void
}) {
  const colors: Record<string, { bg: string; border: string; color: string }> = {
    ALL:      { bg: 'var(--gold-dim)',  border: 'var(--gold)',  color: 'var(--gold)' },
    BUY:      { bg: 'var(--green-dim)', border: 'var(--green)', color: 'var(--green)' },
    SELL:     { bg: 'var(--red-dim)',   border: 'var(--red)',   color: 'var(--red)' },
    TRANSFER: { bg: 'rgba(91,156,246,0.08)', border: 'var(--blue)', color: 'var(--blue)' },
  }
  const c = colors[type]
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 12, padding: '7px 16px',
        borderRadius: 4, border: `1px solid ${active ? c.border : 'var(--border)'}`,
        background: active ? c.bg : 'transparent',
        color: active ? c.color : 'var(--muted)',
        cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.5px',
      }}
    >{label}</button>
  )
}

function TxRow({ tx, price, tick: _tick }: { tx: Transaction; price: number; tick: number }) {
  const trader = tx.trader ?? (tx.type === 'BUY' ? tx.to : tx.from)
  const usd    = price > 0 ? fmtUSD(tx.amount * price) : '--'
  const explorerBase = 'https://explorer.cronos.org'

  const typeColors: Record<string, { bg: string; border: string; color: string }> = {
    BUY:      { bg: 'var(--green-dim)', border: 'rgba(0,208,132,0.2)', color: 'var(--green)' },
    SELL:     { bg: 'var(--red-dim)',   border: 'rgba(255,61,85,0.2)', color: 'var(--red)' },
    TRANSFER: { bg: 'rgba(91,156,246,0.08)', border: 'rgba(91,156,246,0.2)', color: 'var(--blue)' },
  }
  const c = typeColors[tx.type]

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '13px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {timeAgo(tx.timestamp)}
      </td>
      <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: 1,
          padding: '3px 9px', borderRadius: 3, textTransform: 'uppercase',
          background: c.bg, border: `1px solid ${c.border}`, color: c.color,
        }}>{tx.type}</span>
      </td>
      <td style={{ padding: '13px 16px', fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap', color: c.color }}>
        {fmt(tx.amount)} CTR
      </td>
      <td style={{ padding: '13px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted2)', whiteSpace: 'nowrap' }}>
        {usd}
      </td>
      <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
        <a href={`${explorerBase}/address/${trader}`} target="_blank" rel="noopener"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted2)', transition: 'color 0.15s' }}>
          {short(trader)}
        </a>
      </td>
      <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
        <a href={`${explorerBase}/tx/${tx.hash}`} target="_blank" rel="noopener"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--blue)', opacity: 0.7 }}>
          {tx.hash.slice(0, 8)}...
        </a>
      </td>
    </tr>
  )
}
