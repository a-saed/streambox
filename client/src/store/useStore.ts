import { create } from 'zustand';
import type { Channel, EPGSchedule } from '../types';

interface AppState {
  channels: Channel[];
  filtered: Channel[];
  activeChannel: Channel | null;
  epg: EPGSchedule;
  sidebarOpen: boolean;
  sidebarWidth: number;
  category: string;
  searchQuery: string;
  liveHubChannelIds: Set<string>;

  setChannels: (channels: Channel[]) => void;
  setEpg: (epg: EPGSchedule) => void;
  setActiveChannel: (channel: Channel, sources?: string[]) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setCategory: (category: string) => void;
  setSearchQuery: (query: string) => void;
  setLiveHubChannelIds: (ids: string[]) => void;
}

const _storedWidth = () => {
  const v = localStorage.getItem('sb-w');
  return v ? Math.max(220, Math.min(600, parseInt(v, 10))) : 288;
};

export const useStore = create<AppState>((set, get) => ({
  channels: [],
  filtered: [],
  activeChannel: null,
  epg: {},
  sidebarOpen: true,
  sidebarWidth: _storedWidth(),
  category: 'All',
  searchQuery: '',
  liveHubChannelIds: new Set<string>(),

  setChannels: (channels) => set({ channels, filtered: channels }),
  setEpg: (epg) => set({ epg }),

  setActiveChannel: (channel, sources) => {
    const ch = sources?.length ? { ...channel, sources } : channel;
    set({ activeChannel: ch, sidebarOpen: false });
  },

  setLiveHubChannelIds: (ids) => set({ liveHubChannelIds: new Set(ids) }),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (w) => {
    localStorage.setItem('sb-w', String(w));
    set({ sidebarWidth: w });
  },

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
