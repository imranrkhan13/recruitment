import { useState } from 'react';
import { Lock, UserPlus, LogIn, AlertCircle } from 'lucide-react';
import { apiUrl } from '../store';

/**
 * Sign-in / first-run owner setup screen. The app holds candidate
 * phone numbers and screening data, so everything behind this gate
 * requires the owner account.
 */
export default function AuthGate({ mode, onAuthed }) {
  const isSetup = mode === 'setup';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(apiUrl(isSetup ? '/api/auth/setup' : '/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password, ...(isSetup ? { bootstrapSecret: setupCode } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      onAuthed(data.email);
    } catch {
      setError('Could not reach the backend.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <div className="brand-icon">A</div>
          <div className="brand-text">
            <strong>Aria</strong>
            <span>AI Recruiter</span>
          </div>
        </div>

        <h1>{isSetup ? 'Create your owner account' : 'Sign in'}</h1>
        <p className="auth-sub">
          {isSetup
            ? 'One account protects this workspace. Use a password of at least 12 characters.'
            : 'Candidate details and screening results are private. Sign in to continue.'}
        </p>

        <form onSubmit={submit}>
          {error && <div className="error-msg" style={{ marginBottom: 12 }}><AlertCircle size={14} />{error}</div>}
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {isSetup && (
            <div className="form-group">
              <label className="form-label">Setup code</label>
              <input
                className="form-input"
                type="password"
                autoComplete="off"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                required
              />
              <span className="form-hint">The private code from your server setup - it proves this workspace is yours.</span>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {isSetup ? <UserPlus size={15} /> : <LogIn size={15} />}
            {busy ? 'Please wait…' : isSetup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="auth-foot">
          <Lock size={11} /> Sign-in protects this workspace. Records are stored in this project's own database.
        </p>
      </div>
    </div>
  );
}
