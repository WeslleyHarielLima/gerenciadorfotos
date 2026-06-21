/* ═══════════════════════════════════════════════════════════
   ÍCONES — mesmo traço/estilo do modelo "Visão geral"
═══════════════════════════════════════════════════════════ */

export const IC: Record<string, string | string[]> = {
  home:     "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10",
  image:    ["M3 3h18a2 2 0 012 2v14a2 2 0 01-2 2H3a2 2 0 01-2-2V5a2 2 0 012-2z", "M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z", "M21 15l-5-5L5 21"],
  upload:   ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
  edit:     ["M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7", "M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"],
  review:   ["M9 11l3 3L22 4", "M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"],
  publish:  ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
  admin:    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10",
  city:     ["M3 21h18", "M5 21V7l8-4v18", "M19 21V11l-6-4", "M9 9v.01", "M9 12v.01", "M9 15v.01", "M9 18v.01"],
  calendar: ["M3 4h18a2 2 0 012 2v14a2 2 0 01-2 2H3a2 2 0 01-2-2V6a2 2 0 012-2z", "M16 2v4", "M8 2v4", "M3 10h18"],
  chevL:    "M15 18l-6-6 6-6",
  chevR:    "M9 18l6-6-6-6",
  arrow:    "M5 12h14 M12 5l7 7-7 7",
  sun:      ["M12 1v2", "M12 21v2", "M4.22 4.22l1.42 1.42", "M18.36 18.36l1.42 1.42", "M1 12h2", "M21 12h2", "M4.22 19.78l1.42-1.42", "M18.36 5.64l1.42-1.42", "M12 17a5 5 0 100-10 5 5 0 000 10z"],
  moon:     "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  logout:   ["M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  alert:    ["M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z", "M12 9v4", "M12 17h.01"],
  check:    ["M22 11.08V12a10 10 0 11-5.93-9.14", "M22 4L12 14.01l-3-3"],
  clock:    ["M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z", "M12 6v6l4 2"],
  close:    "M18 6L6 18 M6 6l12 12",
  trash:    ["M3 6h18", "M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2", "M10 11v6", "M14 11v6"],
  health:   ["M22 12h-4l-3 9L9 3l-3 9H2"],
  pending:  ["M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z", "M12 6v6l4 2"],
};

export function Ico({
  d,
  size = 18,
  stroke = "currentColor",
  fill = "none",
  sw = 1.6,
}: {
  d: string | string[];
  size?: number;
  stroke?: string;
  fill?: string;
  sw?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
    </svg>
  );
}

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="var(--brand-primary)" opacity="0.15" />
      <rect x="1" y="1" width="30" height="30" rx="7" stroke="var(--brand-primary)" strokeWidth="1" opacity="0.35" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--brand-primary)" fontFamily="Inter,sans-serif">W</text>
    </svg>
  );
}
