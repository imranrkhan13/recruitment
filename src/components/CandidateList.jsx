import { useState } from 'react';
import { Trash2, Phone, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useStore } from '../store';
import '../styles/CandidateList.css';

export default function CandidateList() {
  const { candidates, removeCandidate, updateCandidate, screeningResults, isLoading, setLoading, setScreeningResults } = useStore();
  const [callInitiating, setCallInitiating] = useState(null);
  const [message, setMessage] = useState('');

  const getScreeningResult = (candidateId) => {
    const candidate = candidates.find((item) => item.id === candidateId);
    return screeningResults.find(
      (r) =>
        r.candidateId === candidateId ||
        (candidate?.callId && r.callId === candidate.callId) ||
        (candidate?.phone && r.phoneNumber === candidate.phone)
    );
  };

  const getStatusIcon = (result) => {
    if (!result) return <Clock size={16} className="status-icon pending" />;
    if (result.recommendation === 'PASS') {
      return <CheckCircle size={16} className="status-icon pass" />;
    }
    return <AlertCircle size={16} className="status-icon reject" />;
  };

  const refreshScreenings = async () => {
    try {
      const screeningsResponse = await fetch('/api/screenings');
      if (screeningsResponse.ok) {
        const screenings = await screeningsResponse.json();
        setScreeningResults(screenings.results || []);
      }
    } catch {
      setMessage('Backend is offline. Start the Express server before calling candidates.');
    }
  };

  const watchCallStatus = (candidate, callId) => {
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/call-status/${callId}`);
        const data = await response.json();

        if (response.ok) {
          updateCandidate(candidate.id, { callStatus: data.status });
          setMessage(`Call status for ${candidate.name}: ${data.status}`);
          await refreshScreenings();

          if (data.savedResultId || data.status === 'completed' || data.status === 'call-disconnected') {
            setMessage(`Screening finished for ${candidate.name}. Results are ready below.`);
            return;
          }
        }
      } catch (error) {
        console.warn('Could not refresh call status yet:', error);
      }

      if (attempts < 30) {
        window.setTimeout(poll, 8000);
      }
    };

    window.setTimeout(poll, 5000);
  };

  const initiateCall = async (candidate) => {
    setCallInitiating(candidate.id);
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/initiate-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          candidateName: candidate.name,
          phoneNumber: candidate.phone,
          roleApplied: candidate.role,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        updateCandidate(candidate.id, { callId: data.callId, callInitiated: true });
        setMessage(data.message || `Call initiated for ${candidate.name}.`);

        window.setTimeout(async () => {
          await refreshScreenings();
        }, data.demoMode ? 3000 : 1000);

        if (!data.demoMode && data.callId) {
          watchCallStatus(candidate, data.callId);
        }
      } else {
        const data = await response.json().catch(() => ({}));
        setMessage(
          data.details
            ? `${data.error}: ${data.details}`
            : data.error || 'Failed to initiate call. Check your backend connection.'
        );
      }
    } catch (err) {
      console.error('Error initiating call:', err);
      setMessage('Backend is offline. Run `npm start` from the recruitment folder, then click Call again.');
    } finally {
      setCallInitiating(null);
      setLoading(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <div className="empty-state">
        <Phone size={48} />
        <h3>No Candidates Yet</h3>
        <p>Add candidates from the "Upload" tab to start screening</p>
      </div>
    );
  }

  return (
    <div className="list-container">
      <div className="list-header">
        <h2>Candidates ({candidates.length})</h2>
        {message && <p className="list-message">{message}</p>}
      </div>

      <div className="candidates-table">
        <div className="table-header">
          <div className="col-name">Name</div>
          <div className="col-email">Email</div>
          <div className="col-phone">Phone</div>
          <div className="col-role">Position</div>
          <div className="col-status">Status</div>
          <div className="col-actions">Actions</div>
        </div>

        {candidates.map((candidate) => {
          const result = getScreeningResult(candidate.id);
          return (
            <div key={candidate.id} className="candidate-row-group">
              <div className="table-row">
                <div className="col-name">
                  <strong>{candidate.name}</strong>
                </div>
                <div className="col-email">{candidate.email}</div>
                <div className="col-phone">{candidate.phone}</div>
                <div className="col-role">{candidate.role}</div>
                <div className="col-status">
                  <div className="status-badge">
                    {getStatusIcon(result)}
                    <span>
                      {!result ? 'Pending' : result.recommendation === 'PASS' ? 'Passed' : 'Rejected'}
                    </span>
                  </div>
                </div>
                <div className="col-actions">
                  {!candidate.callInitiated || (!result && candidate.callInitiated) ? (
                    <button
                      className="btn-call"
                      onClick={() => initiateCall(candidate)}
                      disabled={callInitiating === candidate.id || isLoading}
                    >
                      {callInitiating === candidate.id ? 'Calling...' : candidate.callInitiated ? 'Retry' : 'Call'}
                    </button>
                  ) : (
                    <span className="called-badge">
                      {candidate.callStatus ? candidate.callStatus : 'Called'}
                    </span>
                  )}
                  <button className="btn-delete" onClick={() => removeCandidate(candidate.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {result && (
                <div className="candidate-result">
                  <div className="candidate-result-top">
                    <span className={`mini-recommendation ${result.recommendation.toLowerCase()}`}>
                      {result.recommendation}
                    </span>
                    <strong>{result.overallScore}/100</strong>
                    {result.roleCategory && <small>{result.roleCategory}</small>}
                  </div>
                  <p>{result.notes || 'Screening saved. Open Results for the full answer breakdown.'}</p>
                  <dl>
                    <div>
                      <dt>Role probe</dt>
                      <dd>{result.answers?.q3 || 'Not captured yet'}</dd>
                    </div>
                    <div>
                      <dt>Strengths</dt>
                      <dd>{result.strengths || 'Not captured yet'}</dd>
                    </div>
                    <div>
                      <dt>Risks</dt>
                      <dd>{result.risks || 'None noted'}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
