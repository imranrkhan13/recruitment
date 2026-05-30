import { useState } from 'react';
import { UserPlus, AlertCircle, CheckCircle, Lightbulb } from 'lucide-react';
import { useStore } from '../store';
import '../styles/CandidateUpload.css';

const ROLES = [
  'Software Engineer', 'Frontend Engineer', 'Backend Engineer',
  'Full Stack Engineer', 'Data Scientist', 'Product Manager',
  'Sales Executive', 'Marketing Manager', 'Operations Manager',
  'Customer Success Manager', 'HR Manager', 'Finance Analyst',
];

export default function CandidateUpload() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'Software Engineer', company: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { addCandidate } = useStore();

  const handle = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
    setError('');
    setSuccess('');
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Name and phone number are required.');
      return;
    }
    if (!/^\d{10}$/.test(form.phone.replace(/\D/g, ''))) {
      setError('Phone number must be 10 digits (e.g. 9876543210).');
      return;
    }
    addCandidate(form);
    setSuccess(`${form.name} added! Head to Candidates to start the call.`);
    setForm({ name: '', email: '', phone: '', role: 'Software Engineer', company: '' });
  };

  return (
    <div className="upload-wrap">
      {/* Form card */}
      <div className="card upload-form-card">
        <div className="card-header">
          <h2>Add New Candidate</h2>
          <p>Fill in candidate details to schedule an AI phone screen</p>
        </div>

        <form onSubmit={submit} className="upload-form-body">
          {error && <div className="error-msg"><AlertCircle size={14} />{error}</div>}
          {success && <div className="success-msg"><CheckCircle size={14} />{success}</div>}

          {/* Name + Email */}
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label">Full Name <span className="required">*</span></label>
              <input className="form-input" name="name" placeholder="Priya Sharma"
                value={form.name} onChange={handle} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" name="email" placeholder="priya@example.com"
                value={form.email} onChange={handle} />
            </div>
          </div>

          {/* Phone */}
          <div className="form-group">
            <label className="form-label">Phone Number <span className="required">*</span></label>
            <input className="form-input" type="tel" name="phone" placeholder="9876543210"
              value={form.phone} onChange={handle} />
            <span className="form-hint">10-digit Indian mobile number — Aria will call this number</span>
          </div>

          {/* Role + Company */}
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label">Position</label>
              <input className="form-input" name="role" placeholder="Software Engineer"
                list="role-suggestions" value={form.role} onChange={handle} />
              <datalist id="role-suggestions">
                {ROLES.map(r => <option key={r} value={r} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label className="form-label">Company Applying To</label>
              <input className="form-input" name="company" placeholder="Acme Corp"
                value={form.company} onChange={handle} />
            </div>
          </div>

          <div className="form-submit-row">
            <button type="submit" className="btn btn-primary">
              <UserPlus size={15} />
              Add Candidate
            </button>
          </div>
        </form>
      </div>

      {/* Tips sidebar */}
      <div className="tips-card">
        <h3><Lightbulb size={14} /> How Aria Works</h3>
        <ul className="tips-list">
          <li><span className="tip-dot" />Add a candidate with their name, phone, and role.</li>
          <li><span className="tip-dot" />Click <strong>Call</strong> — Aria dials them and conducts a 5-minute structured screen.</li>
          <li><span className="tip-dot" />Aria asks 5 questions: background, motivation, role-specific, availability, and salary.</li>
          <li><span className="tip-dot" />Each answer is scored 0–100 internally. Overall ≥ 70 = PASS.</li>
          <li><span className="tip-dot" />Results are saved automatically — view them in the Results tab.</li>
        </ul>
        <div className="tips-divider" />
        <div className="tips-stat">
          <span>Time saved per candidate</span>
          <strong>~25 min</strong>
        </div>
        <div className="tips-stat" style={{ marginTop: 8 }}>
          <span>Screening accuracy</span>
          <strong>83%</strong>
        </div>
      </div>
    </div>
  );
}