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

  // Sync volume with video
  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    video.muted  = muted;
    video.volume = muted ? 0 : volume / 100;
  }, [volume, muted]);

  // Track fullscreen state
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
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
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  const offset = sidebarOpen ? 'left-72' : 'left-0';

  return (
    <div
      className={`absolute inset-0 z-30 pointer-events-none transition-opacity duration-300
        ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Top bar */}
      <div
        className={`absolute top-0 right-0 ${offset} pointer-events-auto
          flex items-center gap-3 px-5 py-4
          bg-gradient-to-b from-black/80 to-transparent
          transition-[left] duration-300`}
      >
        <button
          onClick={toggleSidebar}
          className="text-white/80 hover:text-white transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
        <span className="text-white/90 font-medium text-sm tracking-wide truncate">
          {activeChannel?.name ?? 'IPTV Player'}
        </span>
      </div>

      {/* Bottom bar — only when a channel is active */}
      {activeChannel && <div
        className={`absolute bottom-14 right-0 ${offset} pointer-events-auto
          flex items-center gap-2 px-5 py-3
          transition-[left] duration-300`}
      >
        {/* Left cluster: play + volume */}
        <div className="flex items-center gap-3 bg-black/50 backdrop-blur-md rounded-xl px-4 py-2.5">
          <button
            onClick={togglePlay}
            className="text-white hover:text-white/70 transition-colors"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>

          <div className="w-px h-4 bg-white/20" />

          <button
            onClick={toggleMute}
            className="text-white/80 hover:text-white transition-colors"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            <VolumeIcon size={18} />
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
            className="w-24 flex-shrink-0"
          />
        </div>

        <div className="flex-1" />

        {/* Right cluster: live badge + fullscreen */}
        <div className="flex items-center gap-3 bg-black/50 backdrop-blur-md rounded-xl px-4 py-2.5">
          {activeChannel && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-red-400 select-none">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          )}
          <button
            onClick={toggleFullscreen}
            className="text-white/80 hover:text-white transition-colors"
            aria-label="Toggle fullscreen"
          >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>}
    </div>
  );
}
