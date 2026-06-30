import { useState, useEffect } from 'react'

const card = {
  background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(51,65,85,0.4)',
  borderRadius: 12, padding: 20,
}

const TYPE_META = {
  price_spike:  { label: 'Price Spike',   color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  icon: '📈' },
  volume_spike: { label: 'Volume Spike',  color: '#a78bfa', bg: 'rgba(139,92,246,0.1)',  icon: '📊' },
  flash_crash:  { label: 'Flash Crash',   color: '#f87171', bg: 'rgba(239,68,68,0.1)',   icon: '⚡' },
  low_liquidity:{ label: 'Low Liquidity', color: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  icon: '💧' },
}

function SeverityBar({ value }) {
  const pct = Math.round(value * 100)
  const color = pct > 70 ? '#f87171' : pct > 40 ? '#f59e0b' : '#34d399'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 9999, background: 'rgba(51,65,85,0.5)' }}>
        <div style={{ width: pct + '%', height: '100%', borderRadius: 9999, background: color, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 700, minWidth: 30 }}>{pct}%</span>
    </div>
  )
}

function AnomalyCard({ a }) {
  const meta = TYPE_META[a.type] || { label: a.type, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '⚠' }
  const ago = Math.round((Date.now() - a.timestamp_ms) / 1000)
  const agoStr = ago < 60 ? ago + 's ago' : Math.round(ago / 60) + 'm ago'

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{meta.icon}</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                background: meta.bg, color: meta.color, border: `1px solid ${meta.color}44`,
              }}>{meta.label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#f59e0b' }}>{a.symbol}</span>
            </div>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{a.description}</p>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: '#475569' }}>{agoStr}</div>
          {a.z_score > 0 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>z={a.z_score.toFixed(1)}</div>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 3 }}>Severity</div>
          <SeverityBar value={a.severity} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#475569' }}>Price at detection</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
            ${a.price < 1 ? a.price.toFixed(4) : a.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Anomalies() {
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/anomalies')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const anomalies = data?.anomalies ?? []

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Anomaly Detection</h2>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
          Real-time Z-score detection across sliding windows of 100 ticks per symbol
        </p>
      </div>

      {/* legend */}
      <div style={{ ...card, marginBottom: 20, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: '#64748b', alignSelf: 'center', fontWeight: 600 }}>Detects:</div>
        {Object.entries(TYPE_META).map(([k, m]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{m.icon}</span>
            <span style={{ fontSize: 12, color: m.color, fontWeight: 600 }}>{m.label}</span>
          </div>
        ))}
      </div>

      {/* thresholds */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Price z-threshold',  value: '3.5σ',  color: '#f59e0b' },
          { label: 'Volume z-threshold', value: '4.0σ',  color: '#a78bfa' },
          { label: 'Flash crash threshold', value: '5%', color: '#f87171' },
        ].map(t => (
          <div key={t.label} style={card}>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.color }}>{t.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>Loading anomalies…</div>
      ) : anomalies.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: '#475569', padding: 40 }}>
          No anomalies detected in current window
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
            {anomalies.length} anomalies detected
            {data?.source === 'demo' && <span style={{ color: '#fcd34d', marginLeft: 8 }}>· demo data</span>}
          </div>
          {anomalies.map((a, i) => <AnomalyCard key={i} a={a} />)}
        </>
      )}
    </div>
  )
}
