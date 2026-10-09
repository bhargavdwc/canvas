import { useEffect } from 'react';
import { useWorldStore } from '../store/worldStore';
import { pathToPoint, pointToPath, getInitialPointFromUrl } from '../utils/coordinates';

/**
 * Keeps the URL (`/@x,y`) and the camera in sync:
 *  - on load, a coordinate URL becomes the starting camera position (at 2% default zoom)
 *  - while moving, the URL is updated (debounced) with replaceState
 *  - back/forward navigation flies the camera to the new coordinate
 */
export function useUrlSync(): void {
  useEffect(() => {
    const initial = getInitialPointFromUrl();
    if (initial) {
      const { camera, setCamera } = useWorldStore.getState();
      setCamera({ ...camera, x: initial.x, y: initial.y, zoom: camera.zoom });
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useWorldStore.subscribe((state, prev) => {
      if (state.camera === prev.camera) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const path = pointToPath(state.camera);
        if (window.location.pathname !== path) window.history.replaceState(null, '', path);
      }, 300);
    });

    const onPopState = () => {
      const point = pathToPoint(window.location.pathname);
      if (point) useWorldStore.getState().requestFlyTo(point);
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);
}
