"use client";

import { useId } from "react";

/**
 * The Covenant arc — a tapered spectral crescent.
 * (In Genesis the rainbow is the sign of the covenant: a promise that
 * holds without either side having to trust the other.)
 *
 * Geometry is drawn in a 200-unit-wide box: two circular arcs share their
 * endpoints, so the shape tapers to nothing at both ends and is `thickness`
 * units thick at the crown.
 */

type Props = {
  width: number;
  sagitta?: number;    // arc height in units (of 200 wide)
  thickness?: number;  // crown thickness in units
  variant?: "light" | "dark";
  glow?: boolean;
  draw?: boolean;      // draw itself in once
  className?: string;
  style?: React.CSSProperties;
};

const radius = (s: number) => (100 * 100 + s * s) / (2 * s);

export function arcPaths(s: number, t: number) {
  const y = s + 2;
  const R = radius(s), r = radius(s - t), m = radius(s - t / 2);
  return {
    height: s + 4,
    shape: `M0 ${y} A${R} ${R} 0 0 1 200 ${y} A${r} ${r} 0 0 0 0 ${y}Z`,
    spine: `M0 ${y} A${m} ${m} 0 0 1 200 ${y}`,
  };
}

// Colour runs left to right: quiet at the start, white-hot at the crown,
// then through the spectrum — as in the original render.
export const SPECTRUM = {
  light: [
    [0, "#AEB6C4"], [0.34, "#C9A15A"], [0.47, "#EC8A2C"], [0.58, "#E9C22A"],
    [0.68, "#39B97A"], [0.78, "#1FA3D6"], [0.89, "#3B5BDB"], [1, "#A24BD6"],
  ],
  dark: [
    [0, "#8E949E"], [0.3, "#F4F1EA"], [0.45, "#FFD8A0"], [0.52, "#FF9F3F"],
    [0.62, "#F7E24A"], [0.71, "#56E39A"], [0.8, "#35CFF5"], [0.9, "#6275FF"], [1, "#D25FF2"],
  ],
} as const;

export function Arc({
  width, sagitta = 40, thickness = 1.8, variant = "light",
  glow = false, draw = false, className, style,
}: Props) {
  const id = useId().replace(/:/g, "");
  const { height, shape, spine } = arcPaths(sagitta, thickness);
  const h = (width * height) / 200;
  const stops = SPECTRUM[variant];

  return (
    <svg width={width} height={h} viewBox={`0 0 200 ${height}`} className={className}
      style={{ overflow: "visible", display: "block", ...style }} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="200" y1="0" y2="0" gradientUnits="userSpaceOnUse">
          {stops.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
        {glow && (
          <filter id={`f${id}`} x="-10%" y="-200%" width="120%" height="500%">
            <feGaussianBlur stdDeviation={thickness * 1.6} />
          </filter>
        )}
        {draw && (
          <mask id={`m${id}`} maskUnits="userSpaceOnUse">
            <path d={spine} pathLength={1} className="arc-draw" fill="none" stroke="#fff" strokeWidth={thickness * 8} strokeLinecap="round" />
          </mask>
        )}
      </defs>
      <g mask={draw ? `url(#m${id})` : undefined}>
        {glow && <path d={shape} fill={`url(#g${id})`} filter={`url(#f${id})`} opacity={0.9} />}
        <path d={shape} fill={`url(#g${id})`} />
      </g>
    </svg>
  );
}
