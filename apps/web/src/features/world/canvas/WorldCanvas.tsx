import { useEffect, useRef } from 'react';
import { WorldRenderer } from './WorldRenderer';

/** Mounts the PixiJS world. All canvas state lives in {@link WorldRenderer}. */
export function WorldCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new WorldRenderer(host);
    void renderer.init();
    return () => renderer.destroy();
  }, []);

  return <div ref={hostRef} id="world-canvas" className="absolute inset-0 touch-none bg-black" />;
}
