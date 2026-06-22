import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { Play, WifiOff, RefreshCw } from 'lucide-react';
import type { Channel } from '../types';
import { proxyStreamUrl } from '../lib/api';

interface VideoPlayerProps {
  channel: Channel | null;
}

export function VideoPlayer({ channel }: VideoPlayerProps) {
  const videoRef         = useRef<HTMLVideoElement>(null);
  const hlsRef            = useRef<Hls | null>(null);
  const mpegtsRef         = useRef<mpegts.Player | null>(null);
  const recoveryRef       = useRef({ network: 0, media: 0 });
  const autoRetryRef      = useRef(0);
  const retryTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const startupTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevChannelUrl    = useRef<string | null>(null);
  const sourceIndexRef    = useRef(0);

  const [status, setStatus]       = useState<'loading' | 'playing' | 'error'>('loading');
  const [buffering, setBuffering] = useState(false);
  const [retryKey, setRetryKey]   = useState(0);
  const [switchingSource, setSwitchingSource] = useState(false);
  const [sourceIndex,     setSourceIndex]     = useState(0);
  const [showSourceChip,  setShowSourceChip]  = useState(false);

  const sources = channel?.sources?.length ? channel.sources : (channel ? [channel.url] : []);

  const handleManualRetry = () => {
    autoRetryRef.current = 0; // manual retry resets the counter
    sourceIndexRef.current = 0;
    setSourceIndex(0);
    setSwitchingSource(false);
    setShowSourceChip(false);
    setRetryKey(k => k + 1);
  };

  useEffect(() => {
    if (sourceIndex > 0) {
      setShowSourceChip(true);
      const timer = setTimeout(() => setShowSourceChip(false), 4_000);
      return () => clearTimeout(timer);
    }
  }, [sourceIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;

    setStatus('loading');
    setBuffering(false);
    recoveryRef.current = { network: 0, media: 0 };

    // Reset auto-retry counter only when the channel actually changes, not on retry
    if (prevChannelUrl.current !== channel.url) {
      prevChannelUrl.current = channel.url;
      autoRetryRef.current = 0;
      sourceIndexRef.current = 0;
      setSourceIndex(0);
      setSwitchingSource(false);
      setShowSourceChip(false);
    }

    if (retryTimerRef.current)    { clearTimeout(retryTimerRef.current);     retryTimerRef.current    = null; }
    if (stallIntervalRef.current) { clearInterval(stallIntervalRef.current); stallIntervalRef.current = null; }
    if (startupTimerRef.current)  { clearTimeout(startupTimerRef.current);   startupTimerRef.current  = null; }

    hlsRef.current?.destroy();     hlsRef.current    = null;
    mpegtsRef.current?.destroy();  mpegtsRef.current = null;

    const url = sources[sourceIndexRef.current] ?? channel.url;

    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      setBuffering(false);
      setStatus('playing');
      setSwitchingSource(false);
      // Cancel the startup watchdog once video is actually playing
      if (startupTimerRef.current) { clearTimeout(startupTimerRef.current); startupTimerRef.current = null; }
    };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);

    const startupWatchdogMs = 10_000;
    startupTimerRef.current = setTimeout(() => {
      if (video.readyState < 2) scheduleAutoRetry();
    }, startupWatchdogMs);

    // Try the next source in the sources array; fall through to error if exhausted
    function tryNextSource() {
      if (sourceIndexRef.current < sources.length - 1) {
        sourceIndexRef.current++;
        setSourceIndex(sourceIndexRef.current);
        setSwitchingSource(true);
        autoRetryRef.current = 0;
        setRetryKey(k => k + 1);
      } else {
        setStatus('error');
      }
    }

    // Auto-retry with backoff before giving up and showing the error screen
    function scheduleAutoRetry() {
      if (autoRetryRef.current >= 3) { tryNextSource(); return; }
      autoRetryRef.current++;
      retryTimerRef.current = setTimeout(
        () => setRetryKey(k => k + 1),
        autoRetryRef.current * 3_000, // 3 s → 6 s → 9 s
      );
    }

    // Stall detector: if currentTime hasn't advanced for 5 s while video is "playing",
    // the stream silently froze. Try to recover without showing an error to the user.
    let lastTime  = -1;
    let stallTicks = 0;
    stallIntervalRef.current = setInterval(() => {
      if (video.paused || video.ended || video.readyState < 2) return;
      if (video.currentTime > 0 && video.currentTime === lastTime) {
        if (++stallTicks >= 5) {
          stallTicks = 0;
          lastTime   = -1;
          if (hlsRef.current) {
            hlsRef.current.startLoad(); // gentle recovery: restart segment loading
          } else {
            scheduleAutoRetry();        // mpegts: full stream reload
          }
        }
      } else {
        lastTime   = video.currentTime;
        stallTicks = 0;
      }
    }, 1_000);

    function loadWithMpegts(tsUrl: string) {
      if (!video || !mpegts.getFeatureList().mseLivePlayback) { scheduleAutoRetry(); return; }
      mpegtsRef.current?.destroy();
      mpegtsRef.current = null;
      video.removeAttribute('src');
      video.load();

      // mpegts.js runs in a Web Worker where relative URLs don't resolve
      const absoluteUrl = new URL(tsUrl, window.location.origin).href;
      const player = mpegts.createPlayer(
        { type: 'mpegts', url: absoluteUrl, isLive: true },
        {
          enableWorker: true,
          // Keep only a small back-buffer so GC stays fast
          autoCleanupSourceBuffer: true,
          autoCleanupMinBackwardDuration: 10,
          autoCleanupMaxBackwardDuration: 20,
          // Smaller stash = lower startup latency for live streams
          enableStashBuffer: true,
          stashInitialSize: 128 * 1024,
          // Don't wait for the full stash before feeding the decoder
          lazyLoad: false,
          deferLoadAfterSourceOpen: false,
          // Catch up to live edge faster when behind
          liveBufferLatencyChasing: true,
          liveBufferLatencyChasingOnPaused: false,
          liveSync: true,
          liveSyncTargetLatency: 8,       // target 8 s behind live edge
          liveSyncPlaybackRate: 1.1,      // chase at 1.1× speed when behind
        },
      );
      mpegtsRef.current = player;
      player.on(mpegts.Events.ERROR, (errType, errDetail) => {
        console.error('[mpegts] error', errType, errDetail);
        scheduleAutoRetry();
      });
      player.attachMediaElement(video);
      player.load();
      video.play().catch(() => {});
    }

    // DaddyLive channels ending in /ts are pre-transcoded MPEG-TS (HEVC→H.264)
    const isDaddyliveTs = url.startsWith('/api/daddylive/') && url.endsWith('/ts');

    if (url.endsWith('.ts') || isDaddyliveTs) {
      loadWithMpegts(proxyStreamUrl(url));
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: -1,

        // Buffer enough to absorb irregular segment delivery from free IPTV servers
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        backBufferLength: 5,

        // Stay ~4 segments behind live edge; chase at 1.1× speed when drifting behind
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 10,
        liveDurationInfinity: true,
        liveBackBufferLength: 0,

        // Start prefetching first fragment before media is attached → faster startup
        startFragPrefetch: true,

        // Fast ABR convergence for live content
        abrEwmaFastLive: 3.0,
        abrEwmaSlowLive: 9.0,

        // Generous timeouts — live IPTV CDNs are occasionally slow.
        fragLoadingTimeOut: 15_000,
        manifestLoadingTimeOut: 10_000,
        levelLoadingTimeOut: 10_000,
        fragLoadingMaxRetry: 4,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 1_000,
        manifestLoadingRetryDelay: 1_000,
        levelLoadingRetryDelay: 1_000,
      });
      hlsRef.current = hls;
      hls.loadSource(proxyStreamUrl(url));
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus('playing');
        setSwitchingSource(false);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        const r = recoveryRef.current;

        // Manifest failed → server likely doesn't support HLS; try raw TS
        const isManifestError =
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR ||
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT;
        if (isManifestError && url.endsWith('.m3u8')) {
          hls.destroy();
          hlsRef.current = null;
          loadWithMpegts(proxyStreamUrl(url.replace(/\.m3u8$/, '.ts')));
          return;
        }

        // Codec not supported (e.g. HEVC on Chrome/Linux) → fall back to
        // server-side ffmpeg transcoding endpoint which outputs H.264 MPEG-TS.
        const isCodecError =
          data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR ||
          (data.details as string) === 'bufferIncompatibleCodecsError';
        if (isCodecError && url.startsWith('/api/daddylive/') && !url.endsWith('/ts')) {
          console.warn('[player] HEVC codec unsupported, switching to server-side transcode');
          hls.destroy();
          hlsRef.current = null;
          loadWithMpegts(proxyStreamUrl(url + '/ts'));
          return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && r.network < 3) {
          r.network++;
          setTimeout(() => hls.startLoad(), 1_000 * r.network);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (r.media === 0) { r.media++; hls.recoverMediaError(); return; }
          if (r.media === 1) { r.media++; hls.swapAudioCodec(); hls.recoverMediaError(); return; }
        }
        scheduleAutoRetry();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = proxyStreamUrl(url);
      video.addEventListener('error', () => scheduleAutoRetry(), { once: true });
      video.play().catch(() => {});
    } else {
      setStatus('error');
    }

    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      if (retryTimerRef.current)   clearTimeout(retryTimerRef.current);
      if (stallIntervalRef.current) clearInterval(stallIntervalRef.current);
      if (startupTimerRef.current) clearTimeout(startupTimerRef.current);
      hlsRef.current?.destroy();    hlsRef.current    = null;
      mpegtsRef.current?.destroy(); mpegtsRef.current = null;
    };
  }, [channel, retryKey]);

  if (!channel) {
    return (
      <div className="relative flex h-full w-full items-center justify-center bg-[#09090b] overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0"
             style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        {/* Center glow */}
        <div className="absolute inset-0"
             style={{ background: 'radial-gradient(circle at 50% 50%, rgba(139,92,246,0.07) 0%, transparent 55%)' }} />
        <div className="relative flex flex-col items-center gap-4"
             style={{ animation: 'fade-up 0.6s ease-out' }}>
          <div className="relative w-20 h-20 rounded-full border border-white/[0.08] flex items-center justify-center">
            <div className="absolute inset-0 rounded-full"
                 style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)' }} />
            <Play size={30} className="text-white/50 ml-0.5" fill="currentColor" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-zinc-300 text-sm font-medium">Select a channel</p>
            <p className="text-zinc-600 text-xs">Open the sidebar to start watching</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        autoPlay
        playsInline
      />

      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/65 backdrop-blur-[2px] z-10">
          <div className="relative w-12 h-12 mb-5">
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-violet-500 border-r-violet-500/40"
                 style={{ animation: 'orbit-cw 1.0s linear infinite' }} />
            <div className="absolute inset-[5px] rounded-full border-2 border-transparent border-b-indigo-400 border-l-indigo-400/40"
                 style={{ animation: 'orbit-ccw 0.75s linear infinite' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400/50" />
            </div>
          </div>
          <p className="text-zinc-200 text-sm font-medium tracking-wide">{channel.name}</p>
          <p className="text-zinc-500 text-xs mt-1.5">
            {switchingSource ? 'Trying next source…' : 'Connecting…'}
          </p>
        </div>
      )}

      {status === 'playing' && buffering && (
        <div className="absolute top-4 right-4 pointer-events-none z-10"
             style={{ animation: 'fade-up 0.2s ease-out' }}>
          <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md rounded-lg px-3 py-1.5 border border-white/[0.06]">
            <div className="w-3 h-3 rounded-full border border-transparent border-t-violet-400"
                 style={{ animation: 'orbit-cw 0.7s linear infinite' }} />
            <span className="text-zinc-400 text-[11px] tracking-wide">Buffering</span>
          </div>
        </div>
      )}

      {showSourceChip && sourceIndex > 0 && (
        <div className="absolute top-4 left-4 pointer-events-none z-10"
             style={{ animation: 'fade-up 0.2s ease-out' }}>
          <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md rounded-lg px-3 py-1.5 border border-white/[0.06]">
            <span className="text-zinc-400 text-[11px] tracking-wide">Source {sourceIndex + 1}</span>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#09090b]/85 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-5 max-w-[220px] text-center"
               style={{ animation: 'fade-up 0.3s ease-out' }}>
            <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-white/[0.06]
                           flex items-center justify-center
                           shadow-[0_0_30px_rgba(239,68,68,0.15)]">
              <WifiOff size={22} className="text-red-400" strokeWidth={1.5} />
            </div>
            <div className="space-y-1">
              <p className="text-white text-sm font-medium">Stream unavailable</p>
              <p className="text-zinc-500 text-[11px] leading-relaxed">
                {sources.length > 1 ? `Tried ${sources.length} source${sources.length !== 1 ? 's' : ''}` : channel.name}
              </p>
            </div>
            <button
              onClick={handleManualRetry}
              className="flex items-center gap-2 px-5 py-2 rounded-xl
                         bg-gradient-to-r from-indigo-600 to-violet-600
                         hover:from-indigo-500 hover:to-violet-500
                         active:scale-[0.97] text-white text-xs font-medium
                         transition-all duration-150 shadow-[0_0_20px_rgba(139,92,246,0.3)]"
            >
              <RefreshCw size={12} />
              Retry
            </button>
            <p className="text-zinc-700 text-[10px]">or select another channel</p>
          </div>
        </div>
      )}
    </div>
  );
}
