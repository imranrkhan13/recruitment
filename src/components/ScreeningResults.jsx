import { useState, useMemo } from 'react';
import {
  BarChart3, RefreshCw, Trash2, ChevronDown, ChevronUp,
  Search, Award, Users, TrendingUp, CheckCircle2,
} from 'lucide-react';
import { useStore } from '../store';
import '../styles/ScreeningResults.css';

function ScoreRing({ score, size = 52 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 70 ? '#166534' : score >= 50 ? '#92400e' : '#991b1b';
  return (
    <div className="score-ring" style={{ width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8d5b8" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="score-ring-text">
        <strong style={{ color, fontSize: size < 50 ? 11 : 14 }}>{score}</strong>
        <small>/100</small>
      </div>
    </div>
  );
}

function ScoreBar({ label, score }) {
  const color = score >= 70 ? '#166534' : score >= 50 ? '#92400e' : '#991b1b';
  return (
    <div className="score-bar-row">
      <span className="score-bar-label">{label}</span>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="score-bar-num">{score}</span>
    </div>
  );
}

export default function ScreeningResults() {
  const { screeningResults, setScreeningResults } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/screenings`);
      if (res.ok) {
        const d = await res.json();
        setScreeningResults(d.results || []);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const deleteResult = async (id, e) => {
    e.stopPropagation();
    await fetch(`${import.meta.env.VITE_API_URL}/api/screenings/${id}`, { method: 'DELETE' });
    setScreeningResults(screeningResults.filter(r => r.id !== id));
  };

  const filtered = useMemo(() => {
    if (!search) return screeningResults;
    const q = search.toLowerCase();
    return screeningResults.filter(r =>
      r.candidateName?.toLowerCase().includes(q) ||
      r.roleApplied?.toLowerCase().includes(q) ||
      r.phoneNumber?.includes(q)
    );
  }, [screeningResults, search]);

  // Stats
  const passCount = screeningResults.filter(r => r.recommendation === 'PASS').length;
  const avg = screeningResults.length
    ? (screeningResults.reduce((s, r) => s + (r.overallScore || 0), 0) / screeningResults.length).toFixed(1)
    : 0;
  const passRate = screeningResults.length
    ? Math.round((passCount / screeningResults.length) * 100)
    : 0;

  if (screeningResults.length === 0) return (
    <div className="card">
      <div className="empty-state" style={{ border: 'none', background: 'transparent' }}>
        <div className="empty-icon"><BarChart3 size={22} /></div>
        <h3>No Screening Results Yet</h3>
        <p>Initiate calls from the Candidates tab. Results will appear here after each screening.</p>
        <button className="btn btn-secondary btn-sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={12} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="results-layout">
      {/* Summary tiles */}
      <div className="summary-bar">
        <div className="summary-tile">
          <span className="summary-tile-label"><Users size={12} /> Total Screened</span>
          <span className="summary-tile-value">{screeningResults.length}</span>
          <span className="summary-tile-sub">candidates interviewed</span>
        </div>
        <div className="summary-tile">
          <span className="summary-tile-label"><CheckCircle2 size={12} /> Passed</span>
          <span className="summary-tile-value" style={{ color: 'var(--success)' }}>{passCount}</span>
          <span className="summary-tile-sub">{passRate}% pass rate</span>
        </div>
        <div className="summary-tile">
          <span className="summary-tile-label"><TrendingUp size={12} /> Avg Score</span>
          <span className="summary-tile-value">{avg}</span>
          <span className="summary-tile-sub">out of 100</span>
        </div>
        <div className="summary-tile">
          <span className="summary-tile-label"><Award size={12} /> Top Score</span>
          <span className="summary-tile-value" style={{ color: 'var(--brown-600)' }}>
            {screeningResults.length ? Math.max(...screeningResults.map(r => r.overallScore || 0)) : 0}
          </span>
          <span className="summary-tile-sub">highest overall</span>
        </div>
      </div>

      {/* Results table card */}
      <div className="card">
        <div className="results-card-header">
          <h2>Screening Results ({filtered.length})</h2>
          <div className="results-search">
            <Search size={12} color="var(--text-4)" />
            <input placeholder="Search name, role…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={12} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="results-list">
          {filtered.map(result => {
            const isOpen = expanded === result.id;
            const cls = result.recommendation === 'PASS' ? 'pass' : 'reject';

            return (
              <div key={result.id}>
                <div
                  className={`result-row ${cls}`}
                  onClick={() => setExpanded(isOpen ? null : result.id)}
                >
                  <ScoreRing score={result.overallScore || 0} size={48} />

                  <div className="result-row-info">
                    <h3>{result.candidateName}</h3>
                    <p>{result.roleApplied} · {result.phoneNumber}</p>
                  </div>

                  <div className="result-row-meta">
                    <span className={`badge ${cls === 'pass' ? 'badge-pass' : 'badge-reject'}`}>
                      {result.recommendation}
                    </span>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={e => deleteResult(result.id, e)}
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                    {isOpen ? <ChevronUp size={14} color="var(--text-3)" /> : <ChevronDown size={14} color="var(--text-3)" />}
                  </div>
                </div>

                {isOpen && (
                  <div className="result-detail">
                    {/* Score breakdown bars */}
                    {result.questionScores && Object.values(result.questionScores).some(s => s > 0) && (
                      <div style={{ marginBottom: 12 }}>
                        <ScoreBar label="Background" score={result.questionScores.q1 || 0} />
                        <ScoreBar label="Motivation" score={result.questionScores.q2 || 0} />
                        <ScoreBar label="Role-specific" score={result.questionScores.q3 || 0} />
                        <ScoreBar label="Availability" score={result.questionScores.q4 || 0} />
                        <ScoreBar label="Salary" score={result.questionScores.q5 || 0} />
                      </div>
                    )}

                    {/* Answer blocks */}
                    <div className="detail-grid">
                      {[
                        { label: 'Background & Experience', key: 'q1' },
                        { label: 'Interest in Role', key: 'q2' },
                        { label: 'Role-Specific Question', key: 'q3' },
                        { label: 'Availability / Notice', key: 'q4' },
                        { label: 'Salary Expectation', key: 'q5' },
                      ].map(({ label, key }) => (
                        <div key={key} className="detail-block">
                          <div className="detail-block-label">{label}</div>
                          <div className="detail-block-text">{result.answers?.[key] || '—'}</div>
                        </div>
                      ))}

                      {result.notes && (
                        <div className="detail-block">
                          <div className="detail-block-label">Recruiter Notes</div>
                          <div className="detail-block-text">{result.notes}</div>
                        </div>
                      )}

                      {result.strengths && (
                        <div className="detail-block" style={{ borderColor: 'var(--success-b)', background: 'var(--success-bg)' }}>
                          <div className="detail-block-label" style={{ color: 'var(--success)' }}>Strengths</div>
                          <div className="detail-block-text">{result.strengths}</div>
                        </div>
                      )}

                      {result.risks && result.risks !== 'None obvious' && (
                        <div className="detail-block" style={{ borderColor: 'var(--danger-b)', background: 'var(--danger-bg)' }}>
                          <div className="detail-block-label" style={{ color: 'var(--danger)' }}>Risks / Red Flags</div>
                          <div className="detail-block-text">{result.risks}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}