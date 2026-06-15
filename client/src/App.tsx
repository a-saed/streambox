import { useEffect, useState } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { Sidebar } from './components/Sidebar';
import { EPGStrip } from './components/EPGStrip';
import { OverlayControls } from './components/OverlayControls';
import { useStore } from './store/useStore';
import { fetchChannels, fetchEPG } from './lib/api';

export default function App() {
  const setChannels = useStore((s) => s.setChannels);
  const setEpg = useStore((s) => s.setEpg);
  const activeChannel = useStore((s) => s.activeChannel);

  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [retryKey, setRetryKey]     = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(false);
    async function load() {
      try {
        const [{ channels, categories: cats }, epgData] = await Promise.all([
          fetchChannels(),
          fetchEPG(),
        ]);
        setChannels(channels);
        setCategories(cats);
        setEpg(epgData);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [setChannels, setEpg, retryKey]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="text-center space-y-4">
          <div className="text-5xl animate-pulse">📡</div>
          <p className="text-zinc-400 text-sm tracking-wide">Loading channels…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="text-center space-y-6 max-w-xs px-6">
          <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto text-3xl">
            📡
          </div>
          <div className="space-y-2">
            <p className="text-white font-semibold text-lg">Service unavailable</p>
            <p className="text-zinc-500 text-sm leading-relaxed">
              We couldn't reach the streaming service. This is usually temporary — please try again in a moment.
            </p>
          </div>
          <button
            onClick={() => setRetryKey(k => k + 1)}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700
              text-white text-sm font-medium rounded-lg transition-colors"
          >
            Try again
          </button>
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
