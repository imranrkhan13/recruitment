import { useEffect } from 'react';
import { BarChart3, Users, UserPlus, WifiOff, FlaskConical, LogOut } from 'lucide-react';
import { useStore, apiUrl, API_BASE } from './store';
import CandidateUpload from './components/CandidateUpload';
import CandidateList from './components/CandidateList';
import ScreeningResults from './components/ScreeningResults';
import AuthGate from './components/AuthGate';
import './styles/App.css';

function App() {
  const {
    activeTab, setActiveTab, candidates, screeningResults,
    setScreeningResults, loadCandidates, importLegacyCandidates,
    backendStatus, callsMode, setBackend,
    authState, authEmail, setAuth, checkAuth, logout,
  } = useStore();

  // Boot: who am I, then data.
  useEffect(() => {
    let isMounted = true;
    const boot = async () => {
      try {
        await checkAuth();
        const health = await fetch(apiUrl('/health'));
        const h = await health.json();
        if (isMounted) setBackend('online', h.callsMode || (h.demoMode ? 'demo' : 'live'));
      } catch {
        if (isMounted) setBackend('offline', null);
      }
    };
    boot();
    return () => { isMounted = false; };
  }, [checkAuth, setBackend]);

  // Data loading + polling once authenticated.
  useEffect(() => {
    if (authState !== 'authed') return undefined;
    let isMounted = true;

    const loadScreenings = async () => {
      try {
        const response = await fetch(apiUrl('/api/screenings'), { credentials: 'same-origin' });
        if (response.status === 401) { if (isMounted) setAuth('login'); return; }
        if (!response.ok) { if (isMounted) setBackend('offline', null); return; }
        const data = await response.json();
        if (isMounted) setScreeningResults(data.results || []);
      } catch {
        if (isMounted) setBackend('offline', null);
      }
    };

    const load = async () => {
      await loadScreenings();
      if (!isMounted) return;
      try {
        await importLegacyCandidates();
        await loadCandidates();
      } catch (err) {
        if (err?.status === 401) { if (isMounted) setAuth('login'); return; }
        if (isMounted) setBackend('offline', null);
      }
    };
    load();

    const hasActiveCall = candidates.some(c => c.callInitiatedAt && !c.callStatus);
    const interval = window.setInterval(loadScreenings, hasActiveCall ? 6000 : 15000);
    return () => { isMounted = false; window.clearInterval(interval); };
  }, [authState, candidates, setScreeningResults, loadCandidates, importLegacyCandidates, setBackend, setAuth]);

  if (authState === 'setup' || authState === 'login') {
    return <AuthGate mode={authState} onAuthed={(email) => setAuth('authed', email)} />;
  }

  const shortlistedCount = screeningResults.filter(r => r.decision === 'shortlisted').length;
  const pendingCount = candidates.filter(c => !screeningResults.find(
    r => r.candidateId === c.id || r.phoneNumber === c.phone
  )).length;

  const tabs = [
    { id: 'upload', label: 'Add', longLabel: 'Add Candidate', icon: UserPlus, count: null },
    { id: 'candidates', label: 'Candidates', icon: Users, count: candidates.length || null },
    { id: 'results', label: 'Results', icon: BarChart3, count: screeningResults.length || null },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">A</div>
          <div className="brand-text">
            <strong>Aria</strong>
            <span>AI Recruiter</span>
          </div>
        </div>

        <p className="nav-section-label">Navigation</p>
        <nav className="app-nav" aria-label="Main navigation">
          {tabs.map(({ id, label, longLabel, icon: Icon, count }) => (
            <button
              key={id}
              className={`nav-btn ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={15} />
              <span className="nav-label-short">{label}</span>
              <span className="nav-label-long">{longLabel || label}</span>
              {count !== null && <span className="nav-badge">{count}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-divider" />

        <div className="sidebar-status">
          <span className={`status-dot ${backendStatus}`} />
          <p>
            {backendStatus === 'offline'
              ? 'Backend offline'
              : backendStatus === 'checking'
                ? 'Connecting to backend…'
                : callsMode === 'demo'
                  ? 'Backend connected · demo calls'
                  : 'Backend connected'}
          </p>
          {authState === 'authed' && (
            <button className="btn btn-ghost btn-sm logout-btn" onClick={logout} title={authEmail || 'Sign out'}>
              <LogOut size={12} /> Sign out
            </button>
          )}
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div className="header-left">
            <p className="kicker">Recruiting workspace</p>
            <h1>Phone Screens</h1>
          </div>
          <div className="header-stats">
            <div className="stat-pill">
              <strong>{candidates.length}</strong>
              <span>Candidates</span>
            </div>
            <div className="stat-pill">
              <strong>{shortlistedCount}</strong>
              <span>Shortlisted</span>
            </div>
            <div className="stat-pill">
              <strong>{pendingCount}</strong>
              <span>Pending</span>
            </div>
          </div>
        </header>

        {backendStatus === 'offline' && (
          <div className="alert-banner error">
            <WifiOff size={15} />
            <span>API unreachable{API_BASE ? <> at <strong>{API_BASE}</strong></> : ''} — start the Express backend with <strong>npm start</strong>.</span>
          </div>
        )}

        {callsMode === 'demo' && backendStatus === 'online' && (
          <div className="alert-banner info">
            <FlaskConical size={15} />
            <span>Demo mode: calls are simulated and results are sample data. No real phone calls are placed.</span>
          </div>
        )}

        <section className="panel">
          {activeTab === 'upload' && <CandidateUpload />}
          {activeTab === 'candidates' && <CandidateList />}
          {activeTab === 'results' && <ScreeningResults />}
        </section>
      </main>
    </div>
  );
}

export default App;
