import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';
import type { Channel } from '../types';

const makeChannel = (overrides: Partial<Channel> = {}): Channel => ({
  id: '1', name: 'BBC News', logo: '', url: 'http://1',
  category: 'News', country: 'GB', language: 'English',
  ...overrides,
});

beforeEach(() => {
  useStore.setState({
    channels: [], filtered: [], activeChannel: null,
    epg: {}, sidebarOpen: true, category: 'All', searchQuery: '',
  });
});

describe('useStore', () => {
  it('setChannels populates both channels and filtered', () => {
    useStore.getState().setChannels([makeChannel()]);
    expect(useStore.getState().channels).toHaveLength(1);
    expect(useStore.getState().filtered).toHaveLength(1);
  });

  it('setSearchQuery filters by name case-insensitively', () => {
    useStore.getState().setChannels([
      makeChannel({ id: '1', name: 'BBC News' }),
      makeChannel({ id: '2', name: 'Al Jazeera', url: 'http://2' }),
    ]);
    useStore.getState().setSearchQuery('bbc');
    expect(useStore.getState().filtered).toHaveLength(1);
    expect(useStore.getState().filtered[0].name).toBe('BBC News');
  });

  it('setCategory filters by category', () => {
    useStore.getState().setChannels([
      makeChannel({ id: '1', name: 'BBC', category: 'News' }),
      makeChannel({ id: '2', name: 'MTV', url: 'http://2', category: 'Music' }),
    ]);
    useStore.getState().setCategory('Music');
    expect(useStore.getState().filtered).toHaveLength(1);
    expect(useStore.getState().filtered[0].name).toBe('MTV');
  });

  it('setCategory All shows all channels', () => {
    useStore.getState().setChannels([
      makeChannel({ id: '1', category: 'News' }),
      makeChannel({ id: '2', url: 'http://2', category: 'Music' }),
    ]);
    useStore.getState().setCategory('Music');
    useStore.getState().setCategory('All');
    expect(useStore.getState().filtered).toHaveLength(2);
  });

  it('setActiveChannel stores channel and closes sidebar', () => {
    const ch = makeChannel();
    useStore.getState().setChannels([ch]);
    useStore.getState().setActiveChannel(ch);
    expect(useStore.getState().activeChannel?.id).toBe('1');
    expect(useStore.getState().sidebarOpen).toBe(false);
  });

  it('toggleSidebar flips sidebarOpen', () => {
    useStore.getState().toggleSidebar();
    expect(useStore.getState().sidebarOpen).toBe(false);
    useStore.getState().toggleSidebar();
    expect(useStore.getState().sidebarOpen).toBe(true);
  });

  it('search and category filters combine correctly', () => {
    useStore.getState().setChannels([
      makeChannel({ id: '1', name: 'BBC News', category: 'News' }),
      makeChannel({ id: '2', name: 'BBC Music', url: 'http://2', category: 'Music' }),
      makeChannel({ id: '3', name: 'Al Jazeera', url: 'http://3', category: 'News' }),
    ]);
    useStore.getState().setCategory('News');
    useStore.getState().setSearchQuery('bbc');
    expect(useStore.getState().filtered).toHaveLength(1);
    expect(useStore.getState().filtered[0].name).toBe('BBC News');
  });
});
