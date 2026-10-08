import React from 'react';

interface VectorProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  color?: string;
  className?: string;
}

/** Technical Crosshair Targeting Vector */
export function CrosshairVector({ size = 24, color = 'currentColor', className = '', ...props }: VectorProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.2" className={className} {...props}>
      <circle cx="12" cy="12" r="8" strokeOpacity="0.4" />
      <circle cx="12" cy="12" r="3" strokeOpacity="0.8" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  );
}

/** Technical Diamond Navigation Marker */
export function DiamondMarker({ size = 20, color = 'currentColor', className = '', ...props }: VectorProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.2" className={className} {...props}>
      <polygon points="10,2 18,10 10,18 2,10" strokeOpacity="0.6" />
      <polygon points="10,5 15,10 10,15 5,10" fill={color} fillOpacity="0.15" strokeOpacity="0.3" />
      <circle cx="10" cy="10" r="1.5" fill={color} />
    </svg>
  );
}

/** Orbital Radar Sensor Symbol */
export function OrbitalSymbol({ size = 24, color = 'currentColor', className = '', ...props }: VectorProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.2" className={className} {...props}>
      <circle cx="12" cy="12" r="10" strokeOpacity="0.3" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="6" strokeOpacity="0.6" />
      <circle cx="12" cy="12" r="2" fill={color} />
      <circle cx="12" cy="2" r="1.5" fill={color} />
      <circle cx="22" cy="12" r="1.5" fill={color} />
    </svg>
  );
}

/** Sector Registration Corner Brackets */
export function CornerBrackets({ size = 24, color = 'currentColor', className = '', ...props }: VectorProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.2" className={className} {...props}>
      <path d="M2 6V2H6" strokeOpacity="0.8" />
      <path d="M18 2H22V6" strokeOpacity="0.8" />
      <path d="M2 18V22H6" strokeOpacity="0.8" />
      <path d="M18 22H22V18" strokeOpacity="0.8" />
      <circle cx="12" cy="12" r="1" fill={color} />
    </svg>
  );
}

/** Scientific Coordinate Node */
export function CoordinateNode({ size = 18, color = 'currentColor', className = '', ...props }: VectorProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke={color} strokeWidth="1" className={className} {...props}>
      <rect x="3" y="3" width="12" height="12" strokeOpacity="0.4" />
      <line x1="9" y1="1" x2="9" y2="17" strokeOpacity="0.25" strokeDasharray="2 2" />
      <line x1="1" y1="9" x2="17" y2="9" strokeOpacity="0.25" strokeDasharray="2 2" />
      <circle cx="9" cy="9" r="2" fill={color} />
    </svg>
  );
}

/** Waypoint Navigation Arrow */
export function WaypointArrow({ size = 16, color = 'currentColor', className = '', ...props }: VectorProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.2" className={className} {...props}>
      <polygon points="8,2 14,14 8,11 2,14" fill={color} fillOpacity="0.2" />
    </svg>
  );
}
