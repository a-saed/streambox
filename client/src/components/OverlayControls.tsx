import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { useStore } from '../store/useStore';

export function OverlayControls() {
  const activeChannel = useStore((s) => s.activeChannel);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  const [visible, setVisible] = useState(true);
  const [volume, setVolume]   = useState(80);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = () => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 3000);
  };

  useEffect(() => {
    window.addEventListener('mousemove', resetTimer);
    resetTimer();
    return () => {
      window.removeEventListener('mousemove', resetTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (video) video.volume = volume / 100;
  }, [volume]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div
      className={`absolute top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 py-3
        bg-gradient-to-b from-black/75 to-transparent
        transition-opacity duration-300
        ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <button
        onClick={toggleSidebar}
        className="text-white hover:text-zinc-300 transition-colors text-xl w-8 flex-shrink-0"
        aria-label="Toggle sidebar"
      >
        ☰
      </button>

      <span className="text-white font-semibold text-sm tracking-wide truncate flex-1">
        {activeChannel?.name ?? 'IPTV Player'}
      </span>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-zinc-400 text-xs">🔊</span>
        <Slider
          value={[volume]}
          onValueChange={(val: number | readonly number[]) => {
            const v = Array.isArray(val) ? (val as readonly number[])[0] : (val as number);
            setVolume(v);
          }}
          min={0}
          max={100}
          step={1}
          className="w-24"
        />
        <button
          onClick={toggleFullscreen}
          className="text-white hover:text-zinc-300 transition-colors ml-2"
          aria-label="Toggle fullscreen"
        >
          ⛶
        </button>
      </div>
    </div>
  );
}
