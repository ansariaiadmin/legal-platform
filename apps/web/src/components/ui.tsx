'use client';

import type { ReactNode } from 'react';

/**
 * P10 UI primitives — tiny, dependency-free, psychology-backed:
 * - <Skeleton/>  : perceived-performance placeholder (never a spinner wall)
 * - <Num/>       : locale-aware figure, tabular-nums, Latin runs isolated so
 *                  the bidi algorithm can never scramble dashes inside RTL prose
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function Num({
  value,
  fa = true,
  title,
}: {
  value: number | string | null | undefined;
  fa?: boolean;
  title?: string;
}) {
  if (value == null || value === '') return <span className="num">—</span>;
  const shown = typeof value === 'number'
    ? new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US').format(value)
    : fa ? toFaDigits(value) : value;
  return (
    <span className="num" title={title} dir="ltr" style={{ unicodeBidi: 'isolate' }}>
      {shown}
    </span>
  );
}

export function Skeleton({
  width = '100%',
  height = 14,
  count = 1,
  gap = 8,
}: {
  width?: number | string;
  height?: number;
  count?: number;
  gap?: number;
}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      <div
        key={i}
        className="sk"
        style={{ width: typeof width === 'number' ? `${width}%` : width, height, marginBottom: i < count - 1 ? gap : 0 }}
      />,
    );
  }
  return <>{rows}</>;
}

/** KPI tile — label whispers, figure speaks (visual hierarchy by size). */
export function Kpi({
  label,
  figure,
  sub,
  tone,
}: {
  label: string;
  figure: ReactNode;
  sub?: string;
  tone?: 'ok' | 'bad' | 'gold' | 'teal';
}) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-figure">{figure}</div>
      {sub && (
        <div className="kpi-sub">
          {tone ? <span className={`pill ${tone}`}>{sub}</span> : sub}
        </div>
      )}
    </div>
  );
}
