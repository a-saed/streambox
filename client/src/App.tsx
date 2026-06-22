import { useEffect, useState } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { Sidebar } from './components/Sidebar';
import { EPGStrip } from './components/EPGStrip';
import { OverlayControls } from './components/OverlayControls';
import { useStore } from './store/useStore';
import { fetchChannels, fetchEPG, fetchHubLive, onUnauthorized } from './lib/api';
import { GateScreen } from './components/GateScreen';
import { Satellite, WifiOff, RefreshCw } from 'lucide-react';

function AppLoader() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#09090b]"
         style={{ animation: 'fade-up 0.5s ease-out' }}>
      <div className="flex flex-col items-center gap-8">
        <div className="relative flex items-center justify-center">
          <div className="absolute w-20 h-20 rounded-3xl border border-violet-500/40"
               style={{ animation: 'signal-ring 2.2s ease-out infinite' }} />
          <div className="absolute w-20 h-20 rounded-3xl border border-violet-400/25"
               style={{ animation: 'signal-ring 2.2s ease-out 0.6s infinite' }} />
          <div className="absolute w-20 h-20 rounded-3xl border border-indigo-500/15"
               style={{ animation: 'signal-ring 2.2s ease-out 1.2s infinite' }} />
          <div className="relative w-16 h-16 rounded-[20px] flex items-center justify-center
                         bg-gradient-to-br from-indigo-600 via-violet-600 to-violet-700
                         shadow-[0_0_50px_rgba(139,92,246,0.45),inset_0_1px_0_rgba(255,255,255,0.15)]">
            <Satellite size={26} className="text-white" strokeWidth={1.5} />
          </div>
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-white text-sm font-semibold tracking-[0.35em] uppercase select-none">
            StreamBox
          </p>
          <p className="text-zinc-600 text-[11px] tracking-wider">Loading channels…</p>
        </div>
        <div className="flex gap-2">
          {[0, 1, 2].map(i => (
            <span key={i} className="block w-1.5 h-1.5 rounded-full bg-violet-500"
                  style={{ animation: `loading-dot 1.4s ease-in-out ${i * 0.18}s infinite` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AppError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#09090b]"
         style={{ animation: 'fade-up 0.5s ease-out' }}>
      <div className="flex flex-col items-center gap-6 max-w-[280px] text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-white/[0.06]
                       flex items-center justify-center
                       shadow-[0_0_30px_rgba(239,68,68,0.12)]">
          <WifiOff size={24} className="text-red-400" strokeWidth={1.5} />
        </div>
        <div className="space-y-2">
          <p className="text-white font-semibold text-base">Service Unavailable</p>
          <p className="text-zinc-500 text-xs leading-relaxed">
            Could not reach the streaming server. Check your connection and try again.
          </p>
        </div>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 w-full py-2.5 px-5 justify-center
                     bg-gradient-to-r from-indigo-600 to-violet-600
                     hover:from-indigo-500 hover:to-violet-500
                     active:scale-[0.98] text-white text-sm font-medium rounded-xl
                     transition-all duration-150 shadow-[0_0_20px_rgba(139,92,246,0.3)]"
        >
          <RefreshCw size={14} />
          Try again
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const setChannels = useStore((s) => s.setChannels);
  const setEpg = useStore((s) => s.setEpg);
  const activeChannel = useStore((s) => s.activeChannel);
  const setLiveHubChannelIds = useStore((s) => s.setLiveHubChannelIds);

  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [retryKey, setRetryKey]     = useState(0);
  const [locked, setLocked]         = useState(false);

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

  useEffect(() => {
    onUnauthorized(() => setLocked(true));
  }, []);

  useEffect(() => {
    fetchHubLive().then(setLiveHubChannelIds);
    const interval = setInterval(
      () => fetchHubLive().then(setLiveHubChannelIds),
      60_000
    );
    return () => clearInterval(interval);
  }, [setLiveHubChannelIds]);

  if (locked) return <GateScreen onUnlock={() => { setLocked(false); setRetryKey(k => k + 1); }} />;
  if (loading) return <AppLoader />;
  if (error) return <AppError onRetry={() => setRetryKey(k => k + 1)} />;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#09090b]">
      <VideoPlayer channel={activeChannel} />
      <OverlayControls />
      <Sidebar categories={categories} />
      <EPGStrip />
    </div>
  );
}
