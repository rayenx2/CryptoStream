import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard.jsx'
import Anomalies from './components/Anomalies.jsx'
import About from './components/About.jsx'

const TABS = ['Dashboard', 'Anomalies', 'About']

const logoSvg = (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect x="2" y="18" width="4" height="12" rx="1" fill="#f59e0b"/>
    <rect x="8" y="12" width="4" height="18" rx="1" fill="#f59e0b"/>
    <rect x="14" y="6" width="4" height="24" rx="1" fill="#f59e0b" opacity="0.8"/>
    <rect x="20" y="14" width="4" height="16" rx="1" fill="#f59e0b" opacity="0.6"/>
    <rect x="26" y="8" width="4" height="22" rx="1" fill="#f59e0b" opacity="0.4"/>
    <polyline points="2,16 8,10 14,14 20,6 26,10" stroke="#3b82f6" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    <circle cx="26" cy="10" r="2" fill="#3b82f6"/>
  </svg>
)

export default function App() {
  const [tab, setTab] = useState('Dashboard')
  const [health, setHealth] = useState(null)

  useEffect(() => {
    fetch('/api/v1/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', color: '#f1f5f9', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* top accent */}
      <div style={{ height: 2, background: 'linear-gradient(90deg,#f59e0b,#3b82f6,#8b5cf6)' }} />

      {/* header */}
      <header style={{
        background: 'rgba(10,15,26,0.96)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(51,65,85,0.4)',
        padding: '0 28px', height: 58,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {logoSvg}
          <span style={{ fontWeight: 800, fontSize: 18 }}>
            <span style={{ color: '#f1f5f9' }}>Crypto</span>
            <span style={{ color: '#f59e0b' }}>Stream</span>
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 9px',
            background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
            border: '1px solid rgba(245,158,11,0.3)', borderRadius: 999,
            letterSpacing: '0.06em',
          }}>LIVE PIPELINE</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {health && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: health.status === 'healthy' ? '#34d399' : '#f87171',
                display: 'inline-block',
              }} />
              <span style={{ color: '#64748b' }}>
                {health.status === 'healthy' ? 'API healthy' : 'API unreachable'}
              </span>
            </div>
          )}
          <nav style={{ display: 'flex', gap: 4 }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: tab === t ? 'rgba(59,130,246,0.15)' : 'transparent',
                border: tab === t ? '1px solid rgba(59,130,246,0.35)' : '1px solid transparent',
                borderRadius: 7, padding: '5px 14px', color: tab === t ? '#60a5fa' : '#64748b',
                fontSize: 13, fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>{t}</button>
            ))}
          </nav>
        </div>
      </header>

      {/* content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px' }}>
        {tab === 'Dashboard'  && <Dashboard />}
        {tab === 'Anomalies'  && <Anomalies />}
        {tab === 'About'      && <About />}
      </main>

      <footer style={{
        borderTop: '1px solid rgba(51,65,85,0.3)', padding: '20px 28px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 8, marginTop: 20,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          <span style={{ color: '#f1f5f9' }}>Crypto</span><span style={{ color: '#f59e0b' }}>Stream</span>
        </span>
        <span style={{ fontSize: 12, color: '#475569' }}>
          Built by{' '}
          <a href="https://github.com/rayenx2" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>Rayen Lassoued</a>
          {' · '}
          <a href="https://linkedin.com/in/Rayen-Lassoued" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>LinkedIn</a>
        </span>
      </footer>
    </div>
  )
}
