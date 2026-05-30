import { useState } from 'react';
import { Upload, AlertCircle } from 'lucide-react';
import { useStore } from '../store';
import '../styles/CandidateUpload.css';

export default function CandidateUpload() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'Software Engineer',
    company: 'Tech Corp',
  });

  const [error, setError] = useState('');
  const { addCandidate } = useStore();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.email.trim() || !formData.phone.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    if (!/^\d{10}$/.test(formData.phone.replace(/\D/g, ''))) {
      setError('Invalid phone number. Please enter 10 digits.');
      return;
    }

    addCandidate(formData);
    setFormData({ name: '', email: '', phone: '', role: 'Software Engineer', company: 'Tech Corp' });
    setError('');
  };

  return (
    <div className="upload-container">
      <div className="upload-header">
        <Upload className="upload-icon" size={24} />
        <h2>Add Candidate</h2>
        <p>Enter candidate details to schedule a phone screen</p>
      </div>

      <form onSubmit={handleSubmit} className="upload-form">
        {error && (
          <div className="error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="name">Full Name *</label>
          <input
            id="name"
            type="text"
            name="name"
            placeholder="John Doe"
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="email">Email *</label>
          <input
            id="email"
            type="email"
            name="email"
            placeholder="john@example.com"
            value={formData.email}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="phone">Phone (10 digits) *</label>
          <input
            id="phone"
            type="tel"
            name="phone"
            placeholder="9876543210"
            value={formData.phone}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="role">Position</label>
            <input
              id="role"
              type="text"
              name="role"
              placeholder="e.g. Senior Engineer"
              value={formData.role}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="company">Company</label>
            <input
              id="company"
              type="text"
              name="company"
              placeholder="e.g. Acme Corp"
              value={formData.company}
              onChange={handleChange}
            />
          </div>
        </div>

        <button type="submit" className="submit-btn">
          Add Candidate
        </button>
      </form>
    </div>
  );
}
