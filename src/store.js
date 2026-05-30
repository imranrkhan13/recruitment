import { create } from 'zustand';

export const useStore = create((set) => ({
  candidates: JSON.parse(localStorage.getItem('aria:candidates') || '[]'),
  screeningResults: [],
  isLoading: false,
  activeTab: 'upload',

  addCandidate: (candidate) =>
    set((state) => {
      const candidates = [
        ...state.candidates,
        {
          ...candidate,
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          createdAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem('aria:candidates', JSON.stringify(candidates));
      return { candidates, activeTab: 'candidates' };
    }),

  updateCandidate: (id, updates) =>
    set((state) => {
      const candidates = state.candidates.map((c) => (c.id === id ? { ...c, ...updates } : c));
      localStorage.setItem('aria:candidates', JSON.stringify(candidates));
      return { candidates };
    }),

  removeCandidate: (id) =>
    set((state) => {
      const candidates = state.candidates.filter((c) => c.id !== id);
      localStorage.setItem('aria:candidates', JSON.stringify(candidates));
      return { candidates };
    }),

  addScreeningResult: (result) =>
    set((state) => ({
      screeningResults: [...state.screeningResults, result],
    })),

  setScreeningResults: (screeningResults) => set({ screeningResults }),
  setLoading: (isLoading) => set({ isLoading }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));