'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type WorkKindSeries = {
  id: string;
  label: string;
  total: number;
  data: Array<{ date: string; value: number }>;
};

const tooltipStyle = {
  background: '#0b0c10',
  border: '1px solid rgba(255,122,0,0.45)',
  borderRadius: 8
};

export const ProductionActivityChart = ({ data }: { data: Array<{ date: string; prace: number }> }) => (
  <ResponsiveContainer height="100%" width="100%">
    <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
      <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="date" stroke="var(--t-dim)" tickLine={false} />
      <YAxis allowDecimals={false} stroke="var(--t-dim)" tickLine={false} />
      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,122,0,0.08)' }} />
      <Bar dataKey="prace" fill="var(--brand)" radius={[6, 6, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
);

export const ProductionTrendCharts = ({ series }: { series: WorkKindSeries[] }) => (
  <section className="rounded-xl border border-border bg-surface p-5">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-semibold text-title">Zadania w czasie</p>
        <p className="mt-1 text-sm text-dim">Liczba poszczególnych prac w kolejnych dniach.</p>
      </div>
      <span className="text-xs font-semibold text-dim">Według wybranego okresu</span>
    </div>
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {series.map((item) => (
        <div className="overflow-hidden rounded-lg border border-border bg-bg" key={item.id}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-title">{item.label}</p>
            <span className="rounded border border-[rgba(255,122,0,0.55)] bg-[rgba(7,8,12,0.9)] px-2 py-0.5 text-sm font-bold text-[var(--brand)]">{item.total}</span>
          </div>
          <div className="h-36 px-2 py-2">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={item.data} margin={{ top: 4, right: 2, left: -24, bottom: -4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="var(--t-dim)" tick={{ fontSize: 10 }} tickLine={false} />
                <YAxis allowDecimals={false} stroke="var(--t-dim)" tick={{ fontSize: 10 }} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,122,0,0.08)' }} />
                <Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  </section>
);
