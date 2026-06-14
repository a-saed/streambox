import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { Channel } from '../types';
import { proxyStreamUrl } from '../lib/api';

interface VideoPlayerProps {
  channel: Channel | null;
}

export function VideoPlayer({ channel }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef   = useRef<Hls | null>(null);
  const [streamError, setStreamError] = useState(false);

  useEffect(() => {
    setStreamError(false);
    const video = videoRef.current;
    if (!video || !channel) return;

    const src = proxyStreamUrl(channel.url);

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setStreamError(true);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => {});
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [channel]);

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
    <>
      {streamError && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
          <div className="text-center space-y-2">
            <div className="text-3xl">⚠️</div>
            <p className="text-zinc-400 text-sm">Stream unavailable</p>
            <p className="text-zinc-600 text-xs">Try another channel</p>
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        className="h-full w-full object-contain bg-black"
        autoPlay
        playsInline
      />
    </>
  );
}
