import type { ReactNode, SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  const { children, ...rest } = props;
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

const p = (d: string, extra?: SVGProps<SVGPathElement>) => <path d={d} {...extra} />;

export const Icon = {
  select: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M5 3l6 15 2.3-5.7L19 10 5 3z" />
    </Svg>
  ),
  highlight: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M9 11l4.5 4.5" />
      <path d="M4 20l5.2-5.2a2.5 2.5 0 013.5 0l5.8-5.8-5-5-5.8 5.8a2.5 2.5 0 000 3.5L3 20h1z" opacity={0} />
      <path d="M3.5 20.5h17" />
    </Svg>
  ),
  underline: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M6 4v6a6 6 0 0012 0V4" />
      <path d="M4 20h16" />
    </Svg>
  ),
  strike: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M16 4a6 6 0 00-5.2 3" />
      <path d="M7.3 9.5A6 6 0 0013 16a5 5 0 004.2-2.2" opacity={0.5} />
      <path d="M4 13h16" />
    </Svg>
  ),
  ink: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 3s6 6.5 6 10.5a6 6 0 01-12 0C6 9.5 12 3 12 3z" />
      <path d="M9.5 14a2.5 2.5 0 002.5 2.5" />
    </Svg>
  ),
  arrow: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M5 19L17 7" />
      <path d="M9 7h8v8" />
    </Svg>
  ),
  rect: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <rect x="4.5" y="6" width="15" height="12" rx="1" />
    </Svg>
  ),
  ellipse: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <ellipse cx="12" cy="12" rx="7.5" ry="5.8" />
    </Svg>
  ),
  text: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M5 6V4h14v2" />
      <path d="M12 4v15" />
      <path d="M9 19h6" />
    </Svg>
  ),
  edit: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </Svg>
  ),
  note: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M4 4h16v16H4z" fill="currentColor" strokeWidth="1" />
      <path d="M15 4v4h4" fill="var(--bg2, #fff)" />
      <path d="M7 10h10M7 14h6" />
    </Svg>
  ),
  sign: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M3 17c2.5-6 5-9.5 6.5-7.5S8.5 14 9.5 15s4.5-7.5 5.5-7.5S16.5 9.5 18 8" />
      <path d="M3 21h18" />
    </Svg>
  ),
  image: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="M3.5 17.5l5-5 3 3 4-4 5 5" />
    </Svg>
  ),
  redact: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="10" height="10" fill="currentColor" stroke="none" />
    </Svg>
  ),
  whiteout: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M6.5 20.5l14-14-3-3-14 14v3h3z" />
      <path d="M14.5 7.5l3 3" />
    </Svg>
  ),
  open: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </Svg>
  ),
  undo: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M8 5L3 10l5 5" />
      <path d="M3 10h11a6 6 0 016 6v1" />
    </Svg>
  ),
  redo: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M16 5l5 5-5 5" />
      <path d="M21 10H10a6 6 0 00-6 6v1" />
    </Svg>
  ),
  download: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 3v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </Svg>
  ),
  zoomIn: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3M11 8v6M8 11h6" />
    </Svg>
  ),
  zoomOut: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3M8 11h6" />
    </Svg>
  ),
  fit: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M9 3H4v5M15 3h5v5M9 21H4v-5M15 21h5v-5" />
    </Svg>
  ),
  rotateCw: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M21 12a9 9 0 11-3-6.7" />
      <path d="M21 3v5h-5" />
    </Svg>
  ),
  rotateCcw: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M3 12a9 9 0 103-6.7" />
      <path d="M3 3v5h5" />
    </Svg>
  ),
  trash: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  ),
  copy: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h10" />
    </Svg>
  ),
  plus: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  split: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 3v18" />
      <path d="M4 7V4h5M4 17v3h5M20 7V4h-5M20 17v3h-5" />
    </Svg>
  ),
  info: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </Svg>
  ),
  print: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <rect x="6" y="14" width="12" height="7" />
    </Svg>
  ),
  file: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z" />
      <path d="M14 3v6h6" />
    </Svg>
  ),
  x: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  check: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M4 12.5l5 5L20 6.5" />
    </Svg>
  ),
  props: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </Svg>
  ),
  logo: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 3a9 9 0 100 18 9 9 0 000-18z" />
      <path d="M8 15l2-6 2 4 2-3 2 5" fill="none" />
    </Svg>
  ),
  sparkle: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 3l2 5.5L19.5 10l-5.5 2L12 17.5 10 12 4.5 10 10 8.5 12 3z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </Svg>
  ),
};
