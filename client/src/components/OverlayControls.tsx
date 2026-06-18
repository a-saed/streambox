import { useEffect, useRef, useState } from 'react';
import {
  Menu, Play, Pause,
  Volume1, Volume2, VolumeX,
  Maximize, Minimize,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useStore } from '../store/useStore';

export function OverlayControls() {
  const activeChannel = useStore((s) => s.activeChannel);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const sidebarOpen   = useStore((s) => s.sidebarOpen);

  const [visible, setVisible]       = useState(true);
  const [playing, setPlaying]       = useState(false);
  const [muted, setMuted]           = useState(false);
  const [volume, setVolume]         = useState(80);
  const [fullscreen, setFullscreen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide
  const resetTimer = () => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 4000);
  };

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'touchstart', 'keydown'] as const;
    events.forEach(e => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Sync play/pause with video
  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    const onPlay  = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    setPlaying(!video.paused);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [activeChannel]);

  // Sync volume/mute with video (video.volume is read-only on iOS — ignore the error)
  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    video.muted = muted;
    try { video.volume = muted ? 0 : volume / 100; } catch { /* iOS ignores volume writes */ }
  }, [volume, muted]);

  // Track fullscreen state (webkit prefix for Safari/iOS)
  useEffect(() => {
    const onChange = () =>
      setFullscreen(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const togglePlay = () => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    video.paused ? video.play().catch(() => {}) : video.pause();
  };

  const toggleMute = () => setMuted(m => !m);

  const toggleFullscreen = () => {
    const video = document.querySelector<HTMLVideoElement>('video');
    const isFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
    if (!isFs) {
      // Standard API (Chrome/Firefox/Android)
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // Fallback: iOS Safari only supports fullscreen on the video element itself
          (video as any)?.webkitEnterFullscreen?.();
        });
      } else if ((document.documentElement as any).webkitRequestFullscreen) {
        (document.documentElement as any).webkitRequestFullscreen();
      } else {
        (video as any)?.webkitEnterFullscreen?.();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else {
        (document as any).webkitExitFullscreen?.();
      }
    }
  };

  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  const offset = sidebarOpen ? sidebarWidth : 0;

  return (
    <div
      className={`absolute inset-0 z-30 pointer-events-none transition-opacity duration-300
        ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 right-0 pointer-events-auto
          flex items-center gap-3 px-5 py-4
          bg-gradient-to-b from-black/75 to-transparent
          transition-[left] duration-300"
        style={{ left: offset }}
      >
        <button
          onClick={toggleSidebar}
          className="w-8 h-8 rounded-xl bg-black/40 hover:bg-black/60 backdrop-blur-sm
                    border border-white/[0.08] flex items-center justify-center
                    text-white/70 hover:text-white transition-all duration-150"
          aria-label="Toggle sidebar"
        >
          <Menu size={16} />
        </button>

        {activeChannel && (
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5 bg-red-500/20 border border-red-500/30
                            px-2 py-0.5 rounded-md">
              <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400 text-[10px] font-bold tracking-widest">LIVE</span>
            </span>
            <span className="text-white/90 font-medium text-sm tracking-wide truncate max-w-[300px]">
              {activeChannel.name}
            </span>
          </div>
        )}

        {!activeChannel && (
          <span className="text-white/40 text-sm">IPTV Player</span>
        )}
      </div>

      {/* Bottom bar */}
      {activeChannel && (
        <div
          className="absolute bottom-14 right-0 pointer-events-auto
            flex items-center gap-2 px-5 py-3
            transition-[left] duration-300"
          style={{ left: offset }}
        >
          <div className="flex items-center gap-3 bg-black/60 backdrop-blur-xl rounded-2xl px-4 py-2.5
                         border border-white/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
            <button
              onClick={togglePlay}
              className="text-white hover:text-white/70 transition-colors"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <div className="w-px h-3.5 bg-white/10" />
            <button
              onClick={toggleMute}
              className="text-white/70 hover:text-white transition-colors"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon size={16} />
            </button>
            <Slider
              value={[muted ? 0 : volume]}
              onValueChange={(val: number | readonly number[]) => {
                const v = Array.isArray(val) ? (val as readonly number[])[0] : (val as number);
                setVolume(v);
                if (v > 0) setMuted(false);
              }}
              min={0}
              max={100}
              step={1}
              className="w-20 flex-shrink-0"
            />
          </div>

          <div className="flex-1" />

          <div className="flex items-center bg-black/60 backdrop-blur-xl rounded-2xl px-4 py-2.5
                         border border-white/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
            <button
              onClick={toggleFullscreen}
              className="text-white/70 hover:text-white transition-colors"
              aria-label="Toggle fullscreen"
            >
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
