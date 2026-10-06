import { useEffect, useRef } from 'react';
import type { ClientWsMessage, ServerWsMessage } from '@canvas/shared-types';
import { useWorldStore } from '../store/worldStore';
import { getViewportBounds } from '../utils/viewport';

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  if (import.meta.env.VITE_API_URL) {
    try {
      const apiUrl = new URL(import.meta.env.VITE_API_URL, window.location.href);
      const proto = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${apiUrl.host}/api/v1/ws`;
    } catch {
      // ignore
    }
  }
  if (import.meta.env.DEV) {
    return 'ws://127.0.0.1:4000/api/v1/ws';
  }
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/ws`;
}

export function useRealtime(): void {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let unmounted = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (unmounted) return;
      const wsUrl = getWsUrl();

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        return;
      }
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as ServerWsMessage;
          if (data.type === 'message.created') {
            const { message } = data;
            useWorldStore.getState().inscribeMessage(message);
            useWorldStore.getState().showToast(
              `New message appeared nearby at ${message.position.x}, ${message.position.y}`,
            );
          }
        } catch {
          // ignore malformed
        }
      };

      ws.onclose = () => {
        if (!unmounted) {
          retryTimer = setTimeout(connect, 4000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    // Subscribe to viewport bounds when camera updates
    let subTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubStore = useWorldStore.subscribe((state, prev) => {
      if (state.camera === prev.camera) return;
      clearTimeout(subTimer);
      subTimer = setTimeout(() => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          const bounds = getViewportBounds(state.camera, {
            width: window.innerWidth,
            height: window.innerHeight,
          });
          const msg: ClientWsMessage = {
            type: 'subscribe',
            bounds: {
              minX: Math.round(bounds.minX),
              maxX: Math.round(bounds.maxX),
              minY: Math.round(bounds.minY),
              maxY: Math.round(bounds.maxY),
            },
          };
          ws.send(JSON.stringify(msg));
        }
      }, 350);
    });

    return () => {
      unmounted = true;
      clearTimeout(retryTimer);
      clearTimeout(subTimer);
      unsubStore();
      wsRef.current?.close();
    };
  }, []);
}
