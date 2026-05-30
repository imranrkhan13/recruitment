import { useEffect, useState } from 'react';
import { AlertCircle, BarChart3, PhoneCall, Users, UserPlus, Wifi, WifiOff } from 'lucide-react';
import { useStore } from './store';
import CandidateUpload from './components/CandidateUpload';
import CandidateList from './components/CandidateList';
import ScreeningResults from './components/ScreeningResults';
import './styles/App.css';

function App() {
  const { activeTab, setActiveTab, candidates, screeningResults, setScreeningResults } = useStore();
  const [backendStatus, setBackendStatus] = useState('checking');

  useEffect(() => {
    let isMounted = true;
    const loadScreenings = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/screenings`);
        if (!response.ok) { if (isMounted) setBackendStatus('offline'); return; }
        const data = await response.json();
        if (isMounted) { setBackendStatus('online'); setScreeningResults(data.results || []); }
      } catch {
        if (isMounted) setBackendStatus('offline');
      }
    };
    loadScreenings();
    const hasActiveCall = candidates.some(c => c.callInitiated && !c.callStatus);
    const interval = window.setInterval(loadScreenings, hasActiveCall ? 6000 : 15000);
    return () => { isMounted = false; window.clearInterval(interval); };
  }, [candidates, setScreeningResults]);

  const passCount = screeningResults.filter(r => r.recommendation === 'PASS').length;
  const pendingCount = candidates.filter(c => !screeningResults.find(
    r => r.candidateId === c.id || r.phoneNumber === c.phone
  )).length;

  const tabs = [
    { id: 'upload', label: 'Add Candidate', icon: UserPlus, count: null },
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
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              className={`nav-btn ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
              {count !== null && <span className="nav-badge">{count}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-divider" />

        <div className="sidebar-status">
          <span className={`status-dot ${backendStatus}`} />
          <p>
            {backendStatus === 'offline'
              ? 'Backend offline — run npm start'
              : backendStatus === 'checking'
                ? 'Connecting to backend…'
                : 'Backend connected'}
          </p>
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
              <strong>{passCount}</strong>
              <span>Passed</span>
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
            <span>API unreachable at <strong>{import.meta.env.VITE_API_URL}</strong> — start the Express backend.</span>
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