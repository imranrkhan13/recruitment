import { create } from 'zustand';

// Same-origin by default (the backend serves the built frontend).
// Set VITE_API_URL only when the API lives on a different origin.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const apiUrl = (path) => `${API_BASE}${path}`;

async function request(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.details = data.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const useStore = create((set, get) => ({
  candidates: [],
  screeningResults: [],
  isLoading: false,
  activeTab: 'upload',
  backendStatus: 'checking',
  callsMode: null,
  authState: 'checking', // 'checking' | 'setup' | 'login' | 'authed'
  authEmail: null,

  setAuth: (authState, authEmail = null) => set({ authState, authEmail }),

  checkAuth: async () => {
    const data = await request('/api/auth/me');
    if (data.setupRequired) set({ authState: 'setup', authEmail: null });
    else if (data.authenticated) set({ authState: 'authed', authEmail: data.email });
    else set({ authState: 'login', authEmail: null });
  },

  logout: async () => {
    try {
      await request('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      set({ authState: 'login', authEmail: null, candidates: [], screeningResults: [] });
    }
  },

  setBackend: (backendStatus, callsMode) => set({ backendStatus, callsMode }),

  loadCandidates: async () => {
    const data = await request('/api/candidates');
    set({ candidates: data.candidates || [] });
  },

  addCandidate: async (candidate) => {
    const data = await request('/api/candidates', {
      method: 'POST',
      body: JSON.stringify(candidate),
    });
    set((state) => {
      const exists = state.candidates.some((c) => c.id === data.candidate.id);
      return {
        candidates: exists
          ? state.candidates.map((c) => (c.id === data.candidate.id ? data.candidate : c))
          : [...state.candidates, data.candidate],
        activeTab: 'candidates',
      };
    });
    return data.candidate;
  },

  updateCandidate: async (id, updates) => {
    // Optimistic local update so the UI feels instant during polling.
    set((state) => ({
      candidates: state.candidates.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
    try {
      await request(`/api/candidates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    } catch {
      // Candidate may not exist on the server yet; the next load reconciles.
    }
  },

  removeCandidate: async (id) => {
    set((state) => ({ candidates: state.candidates.filter((c) => c.id !== id) }));
    await request(`/api/candidates/${id}`, { method: 'DELETE' }).catch(() => {});
  },

  addScreeningResult: (result) =>
    set((state) => ({
      screeningResults: [...state.screeningResults, result],
    })),

  setScreeningResults: (screeningResults) => set({ screeningResults }),

  decideScreening: async (id, decision) => {
    const data = await request(`/api/screenings/${id}/decision`, {
      method: 'PATCH',
      body: JSON.stringify({ decision }),
    });
    set((state) => ({
      screeningResults: state.screeningResults.map((r) => (r.id === id ? data.result : r)),
    }));
    return data.result;
  },

  reviewScreeningUpdate: async (id, action) => {
    const data = await request(`/api/screenings/${id}/review-update`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    set((state) => ({
      screeningResults: state.screeningResults.map((r) => (r.id === id ? data.result : r)),
    }));
    return data.result;
  },

  // One-time import of candidates saved in this browser's localStorage
  // by older versions of the app. Server upsert by id makes it safe to
  // repeat; the local copy is cleared only after the server confirms.
  importLegacyCandidates: async () => {
    let legacy;
    try {
      legacy = JSON.parse(localStorage.getItem('aria:candidates') || '[]');
    } catch {
      return;
    }
    if (!legacy.length) return;
    for (const c of legacy) {
      try {
        await request('/api/candidates', {
          method: 'POST',
          body: JSON.stringify({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            role: c.role,
            company: c.company,
          }),
        });
      } catch {
        return; // server unreachable - keep local copy, retry next load
      }
    }
    localStorage.removeItem('aria:candidates');
    await get().loadCandidates();
  },

  setLoading: (isLoading) => set({ isLoading }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
