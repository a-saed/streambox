import { create } from 'zustand';
import type { Channel, EPGSchedule } from '../types';

interface AppState {
  channels: Channel[];
  filtered: Channel[];
  activeChannel: Channel | null;
  epg: EPGSchedule;
  sidebarOpen: boolean;
  category: string;
  searchQuery: string;

  setChannels: (channels: Channel[]) => void;
  setEpg: (epg: EPGSchedule) => void;
  setActiveChannel: (channel: Channel) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setCategory: (category: string) => void;
  setSearchQuery: (query: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  channels: [],
  filtered: [],
  activeChannel: null,
  epg: {},
  sidebarOpen: true,
  category: 'All',
  searchQuery: '',

  setChannels: (channels) => set({ channels, filtered: channels }),
  setEpg: (epg) => set({ epg }),

  setActiveChannel: (channel) => set({ activeChannel: channel, sidebarOpen: false }),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setCategory: (category) => {
    const { channels, searchQuery } = get();
    const q = searchQuery.toLowerCase();
    const filtered = channels.filter(c => {
      const matchCat    = category === 'All' || c.category === category;
      const matchSearch = !q || c.name.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
    set({ category, filtered });
  },

  setSearchQuery: (searchQuery) => {
    const { channels, category } = get();
    const q = searchQuery.toLowerCase();
    const filtered = channels.filter(c => {
      const matchCat    = category === 'All' || c.category === category;
      const matchSearch = !q || c.name.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
    set({ searchQuery, filtered });
  },
}));
