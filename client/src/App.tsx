import { useEffect, useState } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { Sidebar } from './components/Sidebar';
import { EPGStrip } from './components/EPGStrip';
import { OverlayControls } from './components/OverlayControls';
import { useStore } from './store/useStore';
import { fetchChannels, fetchEPG } from './lib/api';

export default function App() {
  const { setChannels, setEpg, activeChannel } = useStore((s) => ({
    setChannels: s.setChannels,
    setEpg: s.setEpg,
    activeChannel: s.activeChannel,
  }));

  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { channels, categories: cats } = await fetchChannels();
        setChannels(channels);
        setCategories(cats);
        const epgData = await fetchEPG();
        setEpg(epgData);
      } catch {
        setError('Could not connect to the backend. Make sure the server is running on port 3001.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [setChannels, setEpg]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="text-center space-y-3">
          <div className="text-4xl animate-pulse">📡</div>
          <p className="text-zinc-400">Loading channels...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="text-center space-y-2 max-w-sm px-4">
          <div className="text-4xl">⚠️</div>
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-zinc-950">
      <VideoPlayer channel={activeChannel} />
      <OverlayControls />
      <Sidebar categories={categories} />
      <EPGStrip />
    </div>
  );
}
