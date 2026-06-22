import { useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, Satellite, ChevronLeft, Wifi, Search, Radio } from 'lucide-react';
import {
  fetchHubChannels,
  fetchHubStatus,
  fetchHubBest,
  fetchSourceChannels,
  discoverPortals,
  scanHubChannel,
  withToken,
  API_BASE,
  type HubChannel,
  type HubStatus,
} from '../lib/api';
import type { Channel } from '../types';
import { useStore } from '../store/useStore';

interface StreamHit {
  url: string;
  streamName: string;
  portalName: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  bein: 'beIN Sports',
  combat: 'Combat Sports',
  motorsport: 'Motorsport',
  soccer: 'Soccer',
  'us-sport': 'US Sports',
  news: 'News',
  'uk-general': 'UK',
  movies: 'Movies',
  documentary: 'Documentary',
  kids: 'Kids',
  music: 'Music',
  entertainment: 'Entertainment',
  arabic: 'Arabic',
  indian: 'Indian',
};

const CATEGORY_ORDER = [
  'bein', 'arabic', 'soccer', 'combat', 'us-sport', 'motorsport',
  'news', 'uk-general', 'movies', 'documentary',
  'entertainment', 'indian', 'kids', 'music',
];

const SOURCE_LABELS: Record<string, string> = {
  daddylive: 'DaddyLive',
  bintv:     'bintv',
};

// Channels whose category grouping in the source panel we want to show nicely
const DL_CATEGORY_LABELS: Record<string, string> = {
  arabic:        'Arabic',
  soccer:        'Soccer',
  cricket:       'Cricket',
  'us-sport':    'US Sports',
  motorsport:    'Motorsport',
  combat:        'Combat',
  tennis:        'Tennis',
  rugby:         'Rugby',
  golf:          'Golf',
  cycling:       'Cycling',
  boxing:        'Boxing',
  news:          'News',
  entertainment: 'Entertainment',
  kids:          'Kids',
  music:         'Music',
  movies:        'Movies',
  sports:        'Sports',
};

// ── Source panel (direct-play, no scan) ──────────────────────────────────────

interface SourcePanelProps {
  source: string;
  onBack: () => void;
}

function SourcePanel({ source, onBack }: SourcePanelProps) {
  const setActiveChannel = useStore(s => s.setActiveChannel);
  const setSidebarOpen   = useStore(s => s.setSidebarOpen);
  const activeChannel    = useStore(s => s.activeChannel);

  const [channels, setChannels]       = useState<Channel[]>([]);
  const [loading, setLoading]         = useState(true);
  const [query, setQuery]             = useState('');
  const [warmingId, setWarmingId]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(attempt = 0) {
      const chs = await fetchSourceChannels(source);
      if (cancelled) return;
      if (chs.length === 0 && attempt < 4) {
        setTimeout(() => load(attempt + 1), 1500 * (attempt + 1));
        return;
      }
      setChannels(chs);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [source]);

  function play(ch: Channel) {
    // Open the player immediately — VideoPlayer drives its own loading state, so the
    // click never blocks. bintv streams need Playwright interception (20s+ on a cold
    // machine); we warm the server cache in the BACKGROUND and surface a per-channel
    // "connecting…" hint, without freezing the UI or disabling other channels.
    setActiveChannel({ ...ch });
    setSidebarOpen(false);
    if (ch.url.startsWith('/api/bintv/')) {
      setWarmingId(ch.id);
      fetch(withToken(`${API_BASE}${ch.url}`), { signal: AbortSignal.timeout(45_000) })
        .catch(() => { /* VideoPlayer retries / cycles sources on its own */ })
        .finally(() => setWarmingId(null));
    }
  }

  const filtered = query.trim()
    ? channels.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.category.toLowerCase().includes(query.toLowerCase()))
    : channels;

  // Group DaddyLive channels by category; bintv stays flat
  const grouped = source === 'daddylive'
    ? filtered.reduce<Record<string, Channel[]>>((acc, ch) => {
        const key = ch.category || 'other';
        (acc[key] ??= []).push(ch);
        return acc;
      }, {})
    : { '': filtered };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b border-zinc-800/60 flex-shrink-0">
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <Radio size={12} className="text-indigo-400 flex-shrink-0" />
        <span className="text-white font-semibold text-sm flex-1">{SOURCE_LABELS[source] ?? source}</span>
        {!loading && (
          <span className="text-[10px] text-zinc-600 flex-shrink-0">
            {channels.length} channel{channels.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Search */}
      {channels.length > 6 && (
        <div className="relative my-2 flex-shrink-0">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search channels…"
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg
              pl-7 pr-3 py-1.5 text-[11px] text-zinc-300 placeholder:text-zinc-600
              focus:outline-none focus:border-indigo-500/60 transition-colors"
          />
        </div>
      )}

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
        {loading && (
          <div className="flex items-center justify-center h-24 gap-2">
            <div className="w-3 h-3 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-zinc-500 text-xs">Loading…</span>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <p className="text-zinc-500 text-xs">No channels found</p>
          </div>
        )}
        {!loading && Object.entries(grouped).map(([cat, chs]) => (
          <div key={cat}>
            {cat && (
              <h3 className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-0.5 mb-1.5">
                {DL_CATEGORY_LABELS[cat] ?? cat}
              </h3>
            )}
            <div className="space-y-1">
              {chs.map(ch => {
                const isPlaying  = activeChannel?.url === ch.url;
                const isWarming  = warmingId === ch.id;
                return (
                  <button
                    key={ch.id}
                    onClick={() => play(ch)}
                    className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-all group text-left
                      ${isPlaying
                        ? 'bg-indigo-600/20 border-indigo-500/50 ring-1 ring-indigo-500/30'
                        : isWarming
                        ? 'bg-amber-600/20 border-amber-500/40'
                        : 'bg-zinc-800/60 hover:bg-zinc-700/60 border-zinc-700/30 hover:border-zinc-600/50'
                      }`}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors
                      ${isPlaying ? 'bg-indigo-600/50' : isWarming ? 'bg-amber-600/40' : 'bg-indigo-600/20 group-hover:bg-indigo-600/40'}`}>
                      {isWarming
                        ? <span className="w-2.5 h-2.5 border border-amber-400 border-t-transparent rounded-full animate-spin" />
                        : <Play size={9} className="text-indigo-400 fill-indigo-400" />
                      }
                    </div>
                    <span className="flex-1 text-[11px] text-zinc-200 truncate">{ch.name}</span>
                    {isWarming
                      ? <span className="text-[9px] text-amber-400 flex-shrink-0">connecting…</span>
                      : isPlaying
                      ? <span className="flex items-center gap-1 text-[9px] font-semibold text-indigo-400 flex-shrink-0">
                          <span className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" />LIVE
                        </span>
                      : <Wifi size={9} className="text-green-500 flex-shrink-0" />
                    }
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Scan panel ────────────────────────────────────────────────────────────────

interface ScanPanelProps {
  channel: HubChannel;
  onBack: () => void;
  onScanDone?: () => void;
}

function ScanPanel({ channel, onBack, onScanDone }: ScanPanelProps) {
  const setActiveChannel = useStore(s => s.setActiveChannel);
  const setSidebarOpen   = useStore(s => s.setSidebarOpen);
  const activeChannel    = useStore(s => s.activeChannel);

  const [status, setStatus]     = useState('Starting scan…');
  const [hits, setHits]         = useState<StreamHit[]>([]);
  const [query, setQuery]       = useState('');
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  const [done, setDone]         = useState(false);
  const [doneMsg, setDoneMsg]   = useState('');
  const cancelRef = useRef<(() => void) | undefined>(undefined);

  function startScan() {
    setHits([]);
    setDone(false);
    setProgress(null);
    setStatus('Starting scan…');

    cancelRef.current = scanHubChannel(channel.id, {
      onStatus:    msg => setStatus(msg),
      onCandidate: ()  => {},
      onProgress:  (checked, total) => setProgress({ checked, total }),
      onHit:       (url, streamName, portalName) =>
        setHits(prev => [...prev, { url, streamName, portalName }]),
      onDone:      (n, message) => {
        setDone(true);
        setDoneMsg(message ?? `Found ${n} working stream${n !== 1 ? 's' : ''}`);
        onScanDone?.();
      },
      onError:     msg => { setDone(true); setDoneMsg(`Error: ${msg}`); onScanDone?.(); },
    });
  }

  useEffect(() => {
    startScan();
    return () => cancelRef.current?.();
  }, [channel.id]);

  function play(hit: StreamHit) {
    setActiveChannel({ id: hit.url, name: hit.streamName, logo: '', url: hit.url, category: channel.name, country: '', language: '' });
    setSidebarOpen(false);
  }

  const filtered = query.trim()
    ? hits.filter(h =>
        h.streamName.toLowerCase().includes(query.toLowerCase()) ||
        h.portalName.toLowerCase().includes(query.toLowerCase()))
    : hits;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b border-zinc-800/60 flex-shrink-0">
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <span className="text-white font-semibold text-sm flex-1 truncate">{channel.name}</span>
        {done && (
          <button
            onClick={startScan}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
          >
            <RefreshCw size={10} /> Rescan
          </button>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 py-2 flex-shrink-0">
        {!done ? (
          <>
            <div className="w-3 h-3 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin flex-shrink-0" />
            <span className="text-[11px] text-zinc-400 truncate flex-1">{status}</span>
            {progress && (
              <span className="text-[10px] text-zinc-600 flex-shrink-0">
                {progress.checked}/{progress.total}
              </span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-zinc-500">{doneMsg}</span>
        )}
      </div>

      {/* Progress bar */}
      {progress && !done && (
        <div className="h-0.5 bg-zinc-800 rounded-full mb-2 flex-shrink-0">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-300"
            style={{ width: `${(progress.checked / progress.total) * 100}%` }}
          />
        </div>
      )}

      {/* Search box — only once there are results */}
      {hits.length > 2 && (
        <div className="relative mb-2 flex-shrink-0">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter streams…"
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg
              pl-7 pr-3 py-1.5 text-[11px] text-zinc-300 placeholder:text-zinc-600
              focus:outline-none focus:border-indigo-500/60 transition-colors"
          />
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
        {hits.length === 0 && !done && (
          <div className="flex items-center justify-center h-24">
            <p className="text-zinc-600 text-xs">Searching…</p>
          </div>
        )}
        {hits.length === 0 && done && (
          <div className="flex flex-col items-center justify-center h-24 gap-2">
            <Satellite size={20} className="text-zinc-700" />
            <p className="text-zinc-500 text-xs text-center px-4">
              No working streams found. Try discovering more portals below.
            </p>
          </div>
        )}
        {filtered.map((hit, i) => {
          const isPlaying = activeChannel?.url === hit.url;
          return (
            <button
              key={i}
              onClick={() => play(hit)}
              className={`w-full flex items-center gap-2 p-2.5 rounded-lg
                border transition-all group text-left
                ${isPlaying
                  ? 'bg-indigo-600/20 border-indigo-500/50 ring-1 ring-indigo-500/30'
                  : 'bg-zinc-800/60 hover:bg-zinc-700/60 border-zinc-700/30 hover:border-zinc-600/50'
                }`}
            >
              <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors
                ${isPlaying ? 'bg-indigo-600/50' : 'bg-indigo-600/20 group-hover:bg-indigo-600/40'}`}>
                <Play size={10} className="text-indigo-400 fill-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-200 font-medium truncate">{hit.streamName}</p>
                <p className="text-[10px] text-zinc-500 truncate">{hit.portalName}</p>
              </div>
              {isPlaying
                ? <span className="flex items-center gap-1 text-[9px] font-semibold text-indigo-400 flex-shrink-0">
                    <span className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" />NOW
                  </span>
                : <Wifi size={10} className="text-green-500 flex-shrink-0" />
              }
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Channel grid ──────────────────────────────────────────────────────────────

interface HubPanelProps {
  onChannelSelect?: (ch: HubChannel) => void;
}

const SOURCES = ['daddylive', 'bintv'] as const;
type SourceId = typeof SOURCES[number];

export function HubPanel({ onChannelSelect }: HubPanelProps) {
  const liveHubChannelIds = useStore(s => s.liveHubChannelIds);
  const setActiveChannel  = useStore(s => s.setActiveChannel);
  const setSidebarOpen    = useStore(s => s.setSidebarOpen);

  const [channels, setChannels] = useState<HubChannel[]>([]);
  const [status, setStatus]     = useState<HubStatus | null>(null);
  const [selected, setSelected] = useState<HubChannel | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [filter, setFilter]     = useState<string>('all');
  const [activeSource, setActiveSource] = useState<SourceId | null>(null);
  const [scanningChannelId, setScanningChannelId] = useState<string | null>(null);

  useEffect(() => {
    fetchHubChannels().then(setChannels);
    fetchHubStatus().then(setStatus);
  }, []);

  async function handleDiscover() {
    setDiscovering(true);
    await discoverPortals(50);
    setTimeout(async () => {
      const s = await fetchHubStatus();
      setStatus(s);
      setDiscovering(false);
    }, 4000);
  }

  function handleSelect(ch: HubChannel) {
    setScanningChannelId(ch.id);
    setSelected(ch);
    onChannelSelect?.(ch);
  }

  async function handleInstantPlay(ch: HubChannel) {
    const best = await fetchHubBest(ch.id);
    if (!best) {
      handleSelect(ch);
      return;
    }
    const channel: Channel = {
      id: ch.id, name: ch.name, logo: '',
      url: best.url, sources: [best.url],
      category: ch.category ?? '', country: '', language: '',
    };
    setActiveChannel(channel, [best.url]);
    setSidebarOpen(false);
  }

  if (activeSource) {
    return <SourcePanel source={activeSource} onBack={() => setActiveSource(null)} />;
  }

  if (selected) {
    return (
      <ScanPanel
        channel={selected}
        onBack={() => { setSelected(null); setScanningChannelId(null); }}
        onScanDone={() => setScanningChannelId(null)}
      />
    );
  }

  const grouped = CATEGORY_ORDER.reduce<Record<string, HubChannel[]>>((acc, cat) => {
    const chs = channels.filter(c => c.category === cat && (filter === 'all' || c.category === filter));
    if (chs.length) acc[cat] = chs;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Portal status bar */}
      <div className="flex flex-col gap-1 px-0.5">
        <div className="flex items-center gap-2">
          <Satellite size={12} className="text-indigo-400 flex-shrink-0" />
          <span className="text-[11px] text-zinc-500 flex-1">
            {status ? (
              <>
                <span className="text-green-400 font-medium">{status.liveCount} live</span>
                {' · '}
                {status.portalCount} portal{status.portalCount !== 1 ? 's' : ''}
                {' · '}
                {status.channelCount.toLocaleString()} channels
              </>
            ) : 'Loading…'}
          </span>
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md
              bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300
              disabled:opacity-50 transition-all"
          >
            <RefreshCw size={9} className={discovering ? 'animate-spin' : ''} />
            {discovering ? 'Discovering…' : 'Discover more'}
          </button>
        </div>
        {status && status.liveCount > 0 && (
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, (status.liveCount / 150) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Source buttons */}
      <div className="flex gap-1.5 flex-shrink-0">
        {SOURCES.map(src => (
          <button
            key={src}
            onClick={() => setActiveSource(src)}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md
              bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/40 hover:border-indigo-500/40
              text-zinc-400 hover:text-zinc-200 transition-all"
          >
            <Radio size={9} className="text-indigo-400" />
            {SOURCE_LABELS[src]}
          </button>
        ))}
      </div>

      {/* Category filter pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 flex-shrink-0 scrollbar-none">
        {['all', 'bein', 'arabic', 'soccer', 'combat', 'us-sport', 'news', 'movies'].map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`flex-shrink-0 text-[10px] px-2.5 py-1 rounded-full transition-colors
              ${filter === cat
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          >
            {cat === 'all' ? 'All' : CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      {/* Channel grid */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-0.5">
        {Object.entries(grouped).map(([cat, chs]) => (
          <div key={cat}>
            <h3 className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-0.5 mb-2">
              {CATEGORY_LABELS[cat] ?? cat}
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {chs.map(ch => {
                const isLive     = liveHubChannelIds.has(ch.id);
                const isScanning = scanningChannelId === ch.id;

                return (
                  <button
                    key={ch.id}
                    onClick={() => isLive ? handleInstantPlay(ch) : handleSelect(ch)}
                    className={`relative flex flex-col items-center gap-1 p-2 rounded-xl border transition-all group
                      ${isLive
                        ? 'bg-zinc-800/60 hover:bg-zinc-700/60 border-zinc-700/30 hover:border-indigo-500/40'
                        : 'bg-zinc-800/60 hover:bg-zinc-700/60 border-zinc-700/30 hover:border-zinc-600/40'
                      }`}
                  >
                    {/* Health dot */}
                    {isScanning ? (
                      <span className="absolute bottom-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    ) : isLive ? (
                      <span className="absolute bottom-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-green-500" />
                    ) : null}

                    {/* Action icon */}
                    {isLive
                      ? <Play size={9} className="absolute bottom-1.5 right-1.5 text-indigo-400 fill-indigo-400" />
                      : <Search size={9} className="absolute bottom-1.5 right-1.5 text-zinc-600" />
                    }

                    <span className={`text-[9px] font-bold transition-colors leading-none text-center line-clamp-2 min-h-[2.5em]
                      ${isLive ? 'text-zinc-300 group-hover:text-white' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
                      {ch.short}
                    </span>
                    <span className={`text-[8px] truncate w-full text-center
                      ${isLive ? 'text-zinc-600' : 'text-zinc-700'}`}>
                      {ch.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
