import { useState, useEffect, useCallback, useRef } from 'react'

const card = {
  background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(51,65,85,0.4)',
  borderRadius: 12, padding: 20,
}

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return '—'
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(1) + 'M'
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return '$' + Number(n).toFixed(decimals < 4 ? 4 : decimals)
}

function PriceTicker({ coin }) {
  const up = (coin.price_change_24h ?? 0) >= 0
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid rgba(51,65,85,0.2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: '#f59e0b',
        }}>{coin.rank ?? '—'}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{coin.symbol}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{coin.name}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{fmt(coin.price)}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: up ? '#34d399' : '#f87171' }}>
          {up ? '▲' : '▼'} {Math.abs(coin.price_change_24h ?? 0).toFixed(2)}%
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 90 }}>
        <div style={{ fontSize: 11, color: '#475569' }}>Volume</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{fmt(coin.volume)}</div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 110 }}>
        <div style={{ fontSize: 11, color: '#475569' }}>Market Cap</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{fmt(coin.market_cap)}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [ingesting, setIngesting]   = useState(false)
  const [ingestMsg, setIngestMsg]   = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [countdown, setCountdown]   = useState(60)
  const countdownRef = useRef(60)

  const refresh = useCallback(() => {
    fetch('/api/v1/prices')
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(new Date()) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const ingest = useCallback(async () => {
    setIngesting(true)
    setIngestMsg(null)
    try {
      const r = await fetch('/api/v1/ingest', { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        setIngestMsg({ ok: true, text: `✓ Ingested ${d.rows_inserted} coins into PostgreSQL` })
        refresh()
      } else {
        setIngestMsg({ ok: false, text: d.detail || 'Ingest failed' })
      }
    } catch (e) {
      setIngestMsg({ ok: false, text: 'Network error' })
    } finally {
      setIngesting(false)
      setTimeout(() => setIngestMsg(null), 4000)
    }
  }, [refresh])

  // Initial load
  useEffect(() => {
    refresh()
  }, [refresh])

  // Auto-refresh prices every 15s
  useEffect(() => {
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [refresh])

  // Auto-ingest every 60s + countdown display
  useEffect(() => {
    countdownRef.current = 60
    setCountdown(60)

    const tick = setInterval(() => {
      countdownRef.current -= 1
      setCountdown(countdownRef.current)
      if (countdownRef.current <= 0) {
        countdownRef.current = 60
        setCountdown(60)
        // fire ingest silently
        fetch('/api/v1/ingest', { method: 'POST' })
          .then(r => r.json())
          .then(() => refresh())
          .catch(() => {})
      }
    }, 1000)

    return () => clearInterval(tick)
  }, [refresh])

  const prices = data?.prices ?? []
  const totalMC = prices.reduce((s, c) => s + (c.market_cap || 0), 0)
  const gainers = prices.filter(c => (c.price_change_24h ?? 0) > 0).length
  const losers  = prices.filter(c => (c.price_change_24h ?? 0) < 0).length

  const sourceLabel = {
    postgres:         'PostgreSQL (live)',
    coingecko:        'CoinGecko (live)',
    coingecko_cached: 'CoinGecko (cached)',
    stale_cache:      'Stale cache',
    demo:             'Demo mode',
  }[data?.source] ?? data?.source ?? '—'

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Coins Tracked', value: prices.length, color: '#f59e0b' },
          { label: 'Total Mkt Cap', value: totalMC >= 1e12 ? '$' + (totalMC/1e12).toFixed(2) + 'T' : fmt(totalMC), color: '#60a5fa' },
          { label: '24h Gainers',   value: gainers, color: '#34d399' },
          { label: '24h Losers',    value: losers,  color: '#f87171' },
        ].map(k => (
          <div key={k.label} style={card}>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ingest feedback */}
      {ingestMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 500,
          background: ingestMsg.ok ? 'rgba(52,211,153,0.1)' : 'rgba(239,68,68,0.1)',
          color: ingestMsg.ok ? '#34d399' : '#f87171',
          border: `1px solid ${ingestMsg.ok ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)'}`,
        }}>{ingestMsg.text}</div>
      )}

      {/* price list */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Live Prices</h2>
            <p style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              Source: <span style={{ color: '#94a3b8' }}>{sourceLabel}</span>
              {lastRefresh && <> · updated {lastRefresh.toLocaleTimeString()}</>}
            </p>
            <p style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>
              Auto-ingest in <span style={{ color: '#f59e0b', fontWeight: 600 }}>{countdown}s</span> · prices refresh every 15s
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Ingest button */}
            <button
              onClick={ingest}
              disabled={ingesting}
              style={{
                background: ingesting ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: 8, padding: '8px 18px',
                color: ingesting ? '#78350f' : '#f59e0b',
                fontSize: 13, fontWeight: 600,
                cursor: ingesting ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.2s',
              }}
            >
              <span style={{ display: 'inline-block', animation: ingesting ? 'spin 1s linear infinite' : 'none' }}>⬇</span>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              {ingesting ? 'Ingesting…' : 'Ingest Now'}
            </button>

            {/* Refresh button */}
            <button
              onClick={refresh}
              disabled={loading}
              style={{
                background: 'transparent', border: '1px solid rgba(51,65,85,0.5)',
                borderRadius: 8, padding: '8px 16px',
                color: '#64748b', fontSize: 13,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none' }}>⟳</span>
              Refresh
            </button>
          </div>
        </div>

        {data?.source === 'demo' && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', color: '#fcd34d', fontSize: 12, marginBottom: 12 }}>
            No data yet — click <strong>Ingest Now</strong> to fetch live prices from CoinGecko
          </div>
        )}

        {prices.map(c => <PriceTicker key={c.symbol} coin={c} />)}

        {loading && prices.length === 0 && (
          <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>Loading…</div>
        )}
      </div>
    </div>
  )
}
