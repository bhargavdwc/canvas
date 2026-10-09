import type { ReactNode } from 'react';
import { useWorldStore } from '../store/worldStore';
import { getMinZoom } from '../utils/coordinates';

function IconButton(props: { id: string; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      id={props.id}
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className="grid size-10 place-items-center text-slate-300 transition-colors hover:bg-white/10 hover:text-cyan-300 active:scale-90"
    >
      {props.children}
    </button>
  );
}

const iconProps = {
  viewBox: '0 0 24 24',
  className: 'size-4.5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function WorldControls() {
  const zoomBy = useWorldStore((s) => s.zoomBy);
  const requestFlyTo = useWorldStore((s) => s.requestFlyTo);

  return (
    <div className="flex flex-col items-end">
      <div className="flex flex-col divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/15 bg-black shadow-2xl shadow-black/80">
        <IconButton id="zoom-in" label="Zoom in (+)" onClick={() => zoomBy(1.6)}>
          <svg {...iconProps}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </IconButton>
        <IconButton id="zoom-out" label="Zoom out (-)" onClick={() => zoomBy(1 / 1.6)}>
          <svg {...iconProps}>
            <path d="M5 12h14" />
          </svg>
        </IconButton>
        <IconButton
          id="zoom-fit-world"
          label="View full canvas (1,000,000 × 1,000,000)"
          onClick={() => requestFlyTo({ x: 0, y: 0 }, getMinZoom())}
        >
          <svg {...iconProps}>
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

