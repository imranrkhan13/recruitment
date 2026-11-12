import { useState } from 'react';
import { CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { useStore } from '../store';

const DECISION_LABELS = {
  pending: 'Pending review',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
};

/**
 * The AI score and PASS/REJECT are only a suggestion. Shortlisting or
 * rejecting a candidate always takes this explicit human action.
 */
export default function DecisionControls({ result, compact = false }) {
  const { decideScreening } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const decision = result.decision || 'pending';

  const decide = async (next) => {
    setSaving(true);
    setError('');
    try {
      await decideScreening(result.id, next);
    } catch {
      setError('Could not save the decision. Check the backend and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`decision-controls ${compact ? 'compact' : ''}`}>
      <div className="decision-current">
        <span className="decision-label">Your decision</span>
        <span className={`badge decision-${decision}`}>{DECISION_LABELS[decision]}</span>
      </div>
      <div className="decision-actions">
        {decision !== 'shortlisted' && (
          <button
            className="btn btn-sm btn-decision-shortlist"
            disabled={saving}
            onClick={(e) => { e.stopPropagation(); decide('shortlisted'); }}
          >
            <CheckCircle size={11} /> Shortlist
          </button>
        )}
        {decision !== 'rejected' && (
          <button
            className="btn btn-sm btn-decision-reject"
            disabled={saving}
            onClick={(e) => { e.stopPropagation(); decide('rejected'); }}
          >
            <XCircle size={11} /> Reject
          </button>
        )}
        {decision !== 'pending' && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={saving}
            onClick={(e) => { e.stopPropagation(); decide('pending'); }}
            title="Move back to pending review"
          >
            <RotateCcw size={11} /> Reset
          </button>
        )}
      </div>
      {error && <span className="decision-error">{error}</span>}
    </div>
  );
}
