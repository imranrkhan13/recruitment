import { useEffect, useState } from 'react';
import { AlertCircle, BarChart3, Phone, Users } from 'lucide-react';
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
        if (!response.ok) {
          if (isMounted) setBackendStatus('offline');
          return;
        }
        const data = await response.json();
        if (isMounted) {
          setBackendStatus('online');
          setScreeningResults(data.results || []);
        }
      } catch (error) {
        if (isMounted) setBackendStatus('offline');
      }
    };

    loadScreenings();
    const hasActiveCall = candidates.some((candidate) => candidate.callInitiated && !candidate.callStatus);
    const interval = window.setInterval(loadScreenings, hasActiveCall ? 6000 : 15000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [candidates, setScreeningResults]);

  const tabs = [
    { id: 'upload', label: 'Add', icon: Phone },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'results', label: 'Results', icon: BarChart3 },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">A</div>
          <div>
            <strong>Aria</strong>
            <span>AI recruiter</span>
          </div>
        </div>

        <nav className="app-nav" aria-label="Main navigation">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`nav-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={17} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-note">
          <span className={`status-dot ${backendStatus}`} />
          {backendStatus === 'offline'
            ? 'Backend is offline. Start it with `npm run server` or `npm start`.'
            : 'Calls use your Bolna agent when `MOCK_BOLNA_CALLS=false`.'}
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="kicker">Recruiting workspace</p>
            <h1>Phone screens</h1>
          </div>
          <div className="quick-stats">
            <div>
              <strong>{candidates.length}</strong>
              <span>candidates</span>
            </div>
            <div>
              <strong>{screeningResults.length}</strong>
              <span>results</span>
            </div>
          </div>
        </header>

        {backendStatus === 'offline' && (
          <div className="backend-alert">
            <AlertCircle size={17} />
            <span>
              API is not reachable. Calls and results need the Express backend on
              `{import.meta.env.VITE_API_URL}`.
            </span>
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
