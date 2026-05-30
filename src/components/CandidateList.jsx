import { useState, useMemo } from 'react';
import {
  Trash2, Phone, CheckCircle, Clock, AlertCircle, Search,
  RefreshCw, PhoneOff, ChevronDown, ChevronUp, PhoneMissed,
  X
} from 'lucide-react';
import { useStore } from '../store';
import '../styles/CandidateList.css';

// Bolna statuses that mean the candidate declined / didn't pick up
const REJECTED_CALL_STATUSES = new Set([
  'call-rejected', 'rejected', 'busy', 'no-answer', 'failed',
  'not_answered', 'missed', 'declined', 'user-busy',
]);

const FILTER_OPTIONS = ['All', 'Pending', 'Passed', 'Rejected', 'Call Rejected'];

function ScoreRing({ score, size = 52 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 70 ? '#166534' : score >= 50 ? '#92400e' : '#991b1b';
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
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

export default function CandidateList() {
  const {
    candidates, removeCandidate, updateCandidate,
    screeningResults, isLoading, setLoading, setScreeningResults,
  } = useStore();

  const [calling, setCalling] = useState(null);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');

  const getResult = (c) => screeningResults.find(
    r => r.candidateId === c.id || (c.callId && r.callId === c.callId) || (c.phone && r.phoneNumber === c.phone)
  );

  const isCallRejected = (c) =>
    c.callStatus && REJECTED_CALL_STATUSES.has(c.callStatus.toLowerCase());

  const getStatus = (c) => {
    if (isCallRejected(c)) return 'call-rejected';
    const r = getResult(c);
    if (!r) return 'pending';
    return r.recommendation === 'PASS' ? 'pass' : 'reject';
  };

  const filtered = useMemo(() => {
    let list = candidates;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.role?.toLowerCase().includes(q) ||
        c.phone?.includes(q)
      );
    }
    if (filter !== 'All') {
      list = list.filter(c => {
        const s = getStatus(c);
        if (filter === 'Pending') return s === 'pending';
        if (filter === 'Passed') return s === 'pass';
        if (filter === 'Rejected') return s === 'reject';
        if (filter === 'Call Rejected') return s === 'call-rejected';
        return true;
      });
    }
    return list;
  }, [candidates, search, filter, screeningResults]);

  const filterCounts = useMemo(() => ({
    All: candidates.length,
    Pending: candidates.filter(c => getStatus(c) === 'pending').length,
    Passed: candidates.filter(c => getStatus(c) === 'pass').length,
    Rejected: candidates.filter(c => getStatus(c) === 'reject').length,
    'Call Rejected': candidates.filter(c => getStatus(c) === 'call-rejected').length,
  }), [candidates, screeningResults]);

  const refreshScreenings = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/screenings`);
      if (res.ok) {
        const d = await res.json();
        setScreeningResults(d.results || []);
      }
    } catch {
      setMessage('Could not reach backend.');
    }
  };

  const watchStatus = (candidate, callId) => {
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/call-status/${callId}`);
        const data = await res.json();
        if (res.ok) {
          updateCandidate(candidate.id, { callStatus: data.status });
          await refreshScreenings();
          if (data.savedResultId || data.status === 'completed' || data.status === 'call-disconnected') {
            setMessage(`Screening complete for ${candidate.name}.`);
            return;
          }
          // Detect rejection early
          if (REJECTED_CALL_STATUSES.has((data.status || '').toLowerCase())) {
            setMessage(`${candidate.name} declined the call.`);
            return;
          }
        }
      } catch { /* silent */ }
      if (attempts < 30) window.setTimeout(poll, 8000);
    };
    window.setTimeout(poll, 5000);
  };

  const initiateCall = async (candidate) => {
    setCalling(candidate.id);
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/initiate-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          candidateName: candidate.name,
          phoneNumber: candidate.phone,
          roleApplied: candidate.role,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        updateCandidate(candidate.id, { callId: data.callId, callInitiated: true, callStatus: 'ringing' });
        setMessage(data.message || `Call initiated for ${candidate.name}.`);
        setTimeout(refreshScreenings, data.demoMode ? 3000 : 1000);
        if (!data.demoMode && data.callId) watchStatus(candidate, data.callId);
      } else {
        const detail = typeof data.details === 'object' ? JSON.stringify(data.details) : data.details;
        setMessage(detail ? `${data.error}: ${detail}` : data.error || 'Failed to initiate call.');
      }
    } catch {
      setMessage('Backend is offline. Run npm start, then try again.');
    } finally {
      setCalling(null);
      setLoading(false);
    }
  };

  const deleteSelected = () => {
    selected.forEach(id => removeCandidate(id));
    setSelected(new Set());
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const StatusBadge = ({ candidate }) => {
    const s = getStatus(candidate);
    if (s === 'call-rejected') return (
      <span className="badge badge-rejected-call"><PhoneMissed size={10} />Call Rejected</span>
    );
    if (s === 'pass') return <span className="badge badge-pass"><CheckCircle size={10} />Passed</span>;
    if (s === 'reject') return <span className="badge badge-reject"><AlertCircle size={10} />Rejected</span>;
    return <span className="badge badge-pending"><Clock size={10} />Pending</span>;
  };

  if (candidates.length === 0) return (
    <div className="card">
      <div className="empty-state" style={{ border: 'none', background: 'transparent' }}>
        <div className="empty-icon"><Phone size={22} /></div>
        <h3>No Candidates Yet</h3>
        <p>Add candidates from the Add tab to start phone screening.</p>
      </div>
    </div>
  );

  return (
    <div className="card">
      {/* Toolbar */}
      <div className="list-toolbar">
        <h2>Candidates</h2>
        <div className="toolbar-actions">
          <div className="search-box">
            <Search size={12} color="var(--text-4)" />
            <input
              placeholder="Search name, role, phone…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', display: 'flex' }}><X size={11} /></button>}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={refreshScreenings}>
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="filter-strip">
        {FILTER_OPTIONS.map(f => (
          <button
            key={f}
            className={`filter-chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
            <span style={{ fontWeight: 400, opacity: .7 }}>
              {filterCounts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="btn btn-danger btn-sm" onClick={deleteSelected}>
            <Trash2 size={12} /> Delete selected
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {message && <div className="msg-banner">{message}</div>}

      {/* Table */}
      <div className="candidates-table">
        <div className="table-head">
          <div className="table-head-cell" style={{ paddingLeft: 4 }}>
            <input type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={e => setSelected(e.target.checked ? new Set(filtered.map(c => c.id)) : new Set())}
            />
          </div>
          <div className="table-head-cell" style={{ gridColumn: '2/3' }}>Name</div>
          <div className="table-head-cell">Phone</div>
          <div className="table-head-cell">Position</div>
          <div className="table-head-cell">Status</div>
          <div className="table-head-cell">Actions</div>
        </div>

        {filtered.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            No candidates match your filter.
          </div>
        )}

        {filtered.map(candidate => {
          const result = getResult(candidate);
          const rejected = isCallRejected(candidate);
          const isOpen = expanded === candidate.id;

          return (
            <div key={candidate.id}>
              <div className="table-row">
                {/* Checkbox */}
                <div style={{ paddingLeft: 4 }}>
                  <input type="checkbox"
                    checked={selected.has(candidate.id)}
                    onChange={() => toggleSelect(candidate.id)}
                  />
                </div>

                {/* Name */}
                <div className="cell-name">
                  <strong>{candidate.name}</strong>
                  <span>{candidate.email}</span>
                </div>

                {/* Phone */}
                <div className="cell-text">{candidate.phone}</div>

                {/* Role */}
                <div className="cell-text">{candidate.role}</div>

                {/* Status */}
                <div><StatusBadge candidate={candidate} /></div>

                {/* Actions */}
                <div className="cell-actions">
                  {/* Call / Retry / Rejected badge */}
                  {rejected ? (
                    <span className="badge badge-rejected-call" title="Candidate declined the call">
                      <PhoneOff size={10} /> Declined
                    </span>
                  ) : !candidate.callInitiated || (!result && candidate.callInitiated) ? (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => initiateCall(candidate)}
                      disabled={calling === candidate.id || isLoading}
                    >
                      {calling === candidate.id
                        ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Calling…</>
                        : <><Phone size={11} /> {candidate.callInitiated ? 'Retry' : 'Call'}</>
                      }
                    </button>
                  ) : (
                    <span className="badge badge-called">
                      <CheckCircle size={10} /> Called
                    </span>
                  )}

                  {/* Expand results */}
                  {result && (
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => setExpanded(isOpen ? null : candidate.id)}
                      title="View screening details"
                    >
                      {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  )}

                  {/* Delete */}
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => removeCandidate(candidate.id)}
                    title="Remove candidate"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Expandable result detail */}
              {isOpen && result && (
                <div className="result-expand">
                  <div className="result-expand-inner">
                    <div className="result-score-block">
                      <ScoreRing score={result.overallScore} />
                      <span className={`badge ${result.recommendation === 'PASS' ? 'badge-pass' : 'badge-reject'}`}>
                        {result.recommendation}
                      </span>
                    </div>
                    <div className="result-qa-col">
                      <div className="result-qa-label">Background</div>
                      <div className="result-qa-text">{result.answers?.q1 || '—'}</div>
                      <div className="result-qa-label" style={{ marginTop: 8 }}>Motivation</div>
                      <div className="result-qa-text">{result.answers?.q2 || '—'}</div>
                    </div>
                    <div className="result-qa-col">
                      <div className="result-qa-label">Role-specific</div>
                      <div className="result-qa-text">{result.answers?.q3 || '—'}</div>
                      <div className="result-qa-label" style={{ marginTop: 8 }}>Availability</div>
                      <div className="result-qa-text">{result.answers?.q4 || '—'}</div>
                    </div>
                    <div className="result-qa-col">
                      <div className="result-qa-label">Salary expectation</div>
                      <div className="result-qa-text">{result.answers?.q5 || '—'}</div>
                      {result.notes && <>
                        <div className="result-qa-label" style={{ marginTop: 8 }}>Notes</div>
                        <div className="result-qa-text">{result.notes}</div>
                      </>}
                      {result.strengths && <>
                        <div className="result-qa-label" style={{ marginTop: 8 }}>Strengths</div>
                        <div className="result-qa-text">{result.strengths}</div>
                      </>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}