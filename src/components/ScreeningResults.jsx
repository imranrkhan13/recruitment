import { useState } from 'react';
import { BarChart3, User, Award, TrendingUp, RefreshCw, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import '../styles/ScreeningResults.css';

export default function ScreeningResults() {
  const { screeningResults, setScreeningResults } = useStore();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshResults = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch('${import.meta.env.VITE_API_URL}/api/screenings');
      if (response.ok) {
        const data = await response.json();
        setScreeningResults(data.results || []);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const deleteResult = async (id) => {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/screenings/${id}`, { method: 'DELETE' });
    if (response.ok) {
      setScreeningResults(screeningResults.filter((result) => result.id !== id));
    }
  };

  if (screeningResults.length === 0) {
    return (
      <div className="empty-state">
        <BarChart3 size={48} />
        <h3>No Screening Results Yet</h3>
        <p>Initiate calls from the "Candidates" tab to see screening results</p>
        <button className="refresh-btn" onClick={refreshResults} disabled={isRefreshing}>
          <RefreshCw size={16} />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    );
  }

  const passCount = screeningResults.filter((r) => r.recommendation === 'PASS').length;
  const avgScore =
    screeningResults.reduce((sum, r) => sum + (r.overallScore || 0), 0) / screeningResults.length;

  return (
    <div className="results-container">
      <div className="results-header">
        <div className="results-title-row">
          <h2>Screening Results ({screeningResults.length})</h2>
          <button className="refresh-btn" onClick={refreshResults} disabled={isRefreshing}>
            <RefreshCw size={16} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="stats-grid">
          <div className="stat-card">
            <User size={20} />
            <div>
              <p>Total Screened</p>
              <strong>{screeningResults.length}</strong>
            </div>
          </div>
          <div className="stat-card">
            <Award size={20} />
            <div>
              <p>Passed</p>
              <strong>{passCount}</strong>
            </div>
          </div>
          <div className="stat-card">
            <TrendingUp size={20} />
            <div>
              <p>Avg Score</p>
              <strong>{avgScore.toFixed(1)}/100</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="results-list">
        {screeningResults.map((result) => (
          <div key={result.id} className={`result-card ${result.recommendation.toLowerCase()}`}>
            <div className="result-header">
              <div>
                <h3>{result.candidateName}</h3>
                <p>{result.roleApplied}</p>
              </div>
              <div className={`recommendation ${result.recommendation.toLowerCase()}`}>
                {result.recommendation}
              </div>
              <button className="result-delete-btn" onClick={() => deleteResult(result.id)} title="Delete result">
                <Trash2 size={16} />
              </button>
            </div>

            <div className="score-display">
              <div className="score-circle">
                <span>{result.overallScore}</span>
                <small>/100</small>
              </div>
            </div>

            <div className="result-details">
              <p>
                <strong>Phone:</strong> {result.phoneNumber}
              </p>
              {result.roleCategory && (
                <p>
                  <strong>Role type:</strong> {result.roleCategory}
                </p>
              )}
              <p>
                <strong>Notes:</strong> {result.notes || 'N/A'}
              </p>
              {result.strengths && (
                <p>
                  <strong>Strengths:</strong> {result.strengths}
                </p>
              )}
              {result.risks && (
                <p>
                  <strong>Risks:</strong> {result.risks}
                </p>
              )}
            </div>

            {result.answers && (
              <div className="answers-section">
                <h4>Screening Answers</h4>
                <div className="answer-item">
                  <strong>Background:</strong>
                  <p>{result.answers.q1 || 'N/A'}</p>
                </div>
                <div className="answer-item">
                  <strong>Interest in Role:</strong>
                  <p>{result.answers.q2 || 'N/A'}</p>
                </div>
                <div className="answer-item">
                  <strong>Role-specific probe:</strong>
                  <p>{result.answers.q3 || 'N/A'}</p>
                </div>
                <div className="answer-item">
                  <strong>Availability:</strong>
                  <p>{result.answers.q4 || 'N/A'}</p>
                </div>
                <div className="answer-item">
                  <strong>Salary Expectation:</strong>
                  <p>{result.answers.q5 || 'N/A'}</p>
                </div>
              </div>
            )}

            {result.questionScores && (
              <div className="score-breakdown">
                {Object.entries(result.questionScores)
                  .filter(([, score]) => Number(score) > 0)
                  .map(([question, score]) => (
                    <span key={question}>
                      {question.toUpperCase()}: {score}
                    </span>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
