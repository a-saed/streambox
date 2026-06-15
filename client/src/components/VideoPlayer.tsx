import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import type { Channel } from '../types';
import { proxyStreamUrl } from '../lib/api';

interface VideoPlayerProps {
  channel: Channel | null;
}

export function VideoPlayer({ channel }: VideoPlayerProps) {
  const videoRef         = useRef<HTMLVideoElement>(null);
  const hlsRef           = useRef<Hls | null>(null);
  const mpegtsRef        = useRef<mpegts.Player | null>(null);
  const recoveryRef      = useRef({ network: 0, media: 0 });
  const autoRetryRef     = useRef(0);
  const retryTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevChannelUrl   = useRef<string | null>(null);

  const [status, setStatus]       = useState<'loading' | 'playing' | 'error'>('loading');
  const [buffering, setBuffering] = useState(false);
  const [retryKey, setRetryKey]   = useState(0);

  const handleManualRetry = () => {
    autoRetryRef.current = 0; // manual retry resets the counter
    setRetryKey(k => k + 1);
  };

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
    }

    if (retryTimerRef.current)    { clearTimeout(retryTimerRef.current);     retryTimerRef.current    = null; }
    if (stallIntervalRef.current) { clearInterval(stallIntervalRef.current); stallIntervalRef.current = null; }

    hlsRef.current?.destroy();     hlsRef.current    = null;
    mpegtsRef.current?.destroy();  mpegtsRef.current = null;

    const url = channel.url;

    const onWaiting = () => setBuffering(true);
    const onPlaying = () => { setBuffering(false); setStatus('playing'); };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);

    // Auto-retry with backoff before giving up and showing the error screen
    function scheduleAutoRetry() {
      if (autoRetryRef.current >= 3) { setStatus('error'); return; }
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
          autoCleanupSourceBuffer: true,        // prevent buffer overflow → stalls
          autoCleanupMinBackwardDuration: 10,
          autoCleanupMaxBackwardDuration: 20,
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

    if (url.endsWith('.ts')) {
      loadWithMpegts(proxyStreamUrl(url));
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: -1,

        // Live TV: no back-buffer needed (can't rewind) → less memory pressure
        maxBufferLength: 20,
        backBufferLength: 0,

        // Stay close to live edge; jump forward if too far behind
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,

        // Faster retry on network blips
        fragLoadingTimeOut: 15_000,
        manifestLoadingTimeOut: 10_000,
        levelLoadingTimeOut: 10_000,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 500,
        manifestLoadingRetryDelay: 500,
        levelLoadingRetryDelay: 500,
      });
      hlsRef.current = hls;
      hls.loadSource(proxyStreamUrl(url));
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus('playing');
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
      if (retryTimerRef.current)    clearTimeout(retryTimerRef.current);
      if (stallIntervalRef.current) clearInterval(stallIntervalRef.current);
      hlsRef.current?.destroy();    hlsRef.current    = null;
      mpegtsRef.current?.destroy(); mpegtsRef.current = null;
    };
  }, [channel, retryKey]);

  if (!channel) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950">
        <div className="text-center space-y-3">
          <div className="text-6xl">📺</div>
          <p className="text-zinc-500 text-lg">Open the sidebar and select a channel</p>
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
            <p className="text-zinc-400 text-sm">Loading stream…</p>
          </div>
        </div>
      )}

      {status === 'playing' && buffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/90 z-10">
          <div className="text-center space-y-4">
            <div className="text-3xl">⚠️</div>
            <p className="text-zinc-400 text-sm">Stream unavailable</p>
            <button
              onClick={handleManualRetry}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded transition-colors"
            >
              Retry
            </button>
            <p className="text-zinc-600 text-xs">or try another channel</p>
          </div>
        </div>
      )}
    </div>
  );
}
