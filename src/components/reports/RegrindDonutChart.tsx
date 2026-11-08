'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pie, PieChart, ResponsiveContainer, Sector, type PieSectorShapeProps } from 'recharts';
import { formatKg } from '@/lib/utils/format';
import { regrindDonutLayout, type RegrindDonutItem } from '@/lib/utils/regrindDonutLayout';

const sameNumbers = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

export function RegrindDonutChart({ title, items, total }: {
  title: string;
  items: RegrindDonutItem[];
  total: number;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const frameRef = useRef(0);
  const [measurements, setMeasurements] = useState({ width: 1200, heights: [] as number[], nameHeights: [] as number[], angles: [] as number[] });
  const layout = useMemo(() => regrindDonutLayout(items, measurements.width, measurements), [items, measurements]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const width = root.getBoundingClientRect().width;
    const labels = [...root.querySelectorAll<HTMLElement>('[data-regrind-callout]')];
    const heights = labels.map((label) => label.getBoundingClientRect().height);
    const nameHeights = labels.map((label) => label.querySelector('[data-regrind-label="name"]')?.getBoundingClientRect().height ?? 40);
    const angles = [...root.querySelectorAll<SVGGElement>('[data-regrind-sector]')].map((sector) => Number(sector.dataset.angle));
    if (width <= 0 || angles.some((angle) => !Number.isFinite(angle))) return;
    setMeasurements((current) => current.width === width && sameNumbers(current.heights, heights)
      && sameNumbers(current.nameHeights, nameHeights) && sameNumbers(current.angles, angles)
      ? current : { width, heights, nameHeights, angles });
  }, []);

  const scheduleMeasure = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(measure);
  }, [measure]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(root);
    root.querySelectorAll('[data-regrind-callout]').forEach((label) => observer.observe(label));
    scheduleMeasure();
    return () => { observer.disconnect(); cancelAnimationFrame(frameRef.current); };
  }, [items, scheduleMeasure]);

  const renderSector = (sector: PieSectorShapeProps) => (
    <g ref={(node) => { if (node) scheduleMeasure(); }} data-regrind-sector={sector.index} data-angle={sector.midAngle}>
      <Sector cx={sector.cx} cy={sector.cy} innerRadius={sector.innerRadius} outerRadius={sector.outerRadius}
        startAngle={sector.startAngle} endAngle={sector.endAngle} cornerRadius={9}
        fill={layout.callouts[sector.index]?.color} stroke="var(--surface-1)" strokeWidth={3} />
    </g>
  );

  return (
    <figure ref={rootRef} className="relative mx-auto w-full min-w-0" data-regrind-donut={title} aria-label={`${title}: ${formatKg(total)}`}
      style={{ height: layout.height, maxWidth: 1200 }}>
      <div className="reports-donut-chart-area absolute inset-0" aria-hidden="true"
        style={{ height: '100%', background: 'none', pointerEvents: 'none' }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: layout.width, height: layout.height }}>
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <Pie data={layout.callouts} dataKey="value" nameKey="label" cx={layout.cx} cy={layout.cy}
              innerRadius={layout.radius * 0.62} outerRadius={layout.radius} paddingAngle={Math.min(3, 90 / Math.max(1, items.length))} cornerRadius={9}
              startAngle={90} endAngle={-270} isAnimationActive={false} shape={renderSector} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <svg className="pointer-events-none absolute inset-0" width="100%" height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
        {layout.callouts.map((item) => (
          <g key={item.index}>
            <path d={item.path} fill="none" stroke="var(--t-muted)" strokeOpacity={0.8} strokeWidth={1.25}
              strokeLinecap="round" strokeLinejoin="round" data-regrind-connector={item.index} />
            <circle cx={item.start.x} cy={item.start.y} r={2} fill={item.color} />
            <circle cx={item.end.x} cy={item.end.y} r={2.5} fill={item.color} />
          </g>
        ))}
      </svg>
      <div className="pointer-events-none absolute text-center" style={{ left: layout.cx, top: layout.cy, width: layout.radius * 1.15, transform: 'translate(-50%, -50%)' }}>
        <p className="text-xs font-semibold uppercase text-dim">Łącznie</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-title" style={{ overflowWrap: 'anywhere' }}>{formatKg(total)}</p>
      </div>
      <div role="list" aria-label="Przemiały i kilogramy">
        {layout.callouts.map((item) => (
          <div key={item.index} role="listitem" data-regrind-callout={item.index}
            className="absolute" style={{ left: item.x, top: item.y, width: item.width, textAlign: (item.left && !layout.compact) || (!item.left && layout.compact) ? 'right' : 'left' }}>
            <p className="font-semibold text-body" data-regrind-label="name"
              style={{ fontSize: 14, lineHeight: '20px', overflowWrap: 'anywhere' }}>{item.label}</p>
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3" style={{ justifyContent: (item.left && !layout.compact) || (!item.left && layout.compact) ? 'flex-end' : 'flex-start' }}>
              <span className="text-base font-semibold tabular-nums text-title" data-regrind-label="quantity">{formatKg(item.value)}</span>
              <span className="text-xs tabular-nums text-dim">{(total > 0 ? item.value / total * 100 : 0).toFixed(1).replace('.', ',')}%</span>
            </p>
          </div>
        ))}
      </div>
    </figure>
  );
}
