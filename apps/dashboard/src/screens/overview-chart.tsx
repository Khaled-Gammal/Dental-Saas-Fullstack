import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';

/**
 * The overview's charts on shadcn/ui's chart (recharts; user 2026-10-21), after the simple Untitled UI layout the user
 * chose: one line chart over time and a sparkline per figure. One file, loaded on demand: only the owner and the
 * accountant, who see them, download recharts. Time runs right to left as Arabic reads (the oldest point by the amounts
 * axis, on the right); screen readers get the chart's numbers as a table.
 */

export interface TrendPoint { key: string; label: string; collections: number; expenses: number }

/** Net collections and expenses over the period, one point per day or month. */
export function MoneyTrend({ points, labels, format, axisFormat }: {
  points: TrendPoint[];
  labels: { collections: string; expenses: string; title: string };
  format: (minor: number) => string;
  axisFormat: (minor: number) => string;
}) {
  const config = {
    collections: { label: labels.collections, color: 'var(--chart-1)' },
    expenses: { label: labels.expenses, color: 'var(--chart-2)' },
  } satisfies ChartConfig;
  return (
    <figure className="ov-figure">
      <ChartContainer config={config} className="aspect-auto h-[300px] w-full" aria-hidden>
        <LineChart data={points} margin={{ top: 8, right: 4, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" reversed tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} />
          <YAxis orientation="right" tickLine={false} axisLine={false} width={64} tickFormatter={axisFormat} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => (
            <span className="flex w-full items-center justify-between gap-4">
              <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
              <bdi className="font-semibold tabular-nums">{format(Number(value))}</bdi>
            </span>
          )} />} />
          <ChartLegend content={<ChartLegendContent />} />
          {/* monotone: smooth without overshooting a point (these amounts are never below zero) */}
          <Line dataKey="collections" type="monotone" stroke="var(--color-collections)" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
          <Line dataKey="expenses" type="monotone" stroke="var(--color-expenses)" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>{labels.title}</caption>
        <thead><tr><th scope="col" /><th scope="col">{labels.collections}</th><th scope="col">{labels.expenses}</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.key}><th scope="row">{p.label}</th><td>{format(p.collections)}</td><td>{format(p.expenses)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** The small trend inside a figure card (decorative: the card's number and its ▲/▼ carry the meaning). */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const data = values.map((v, i) => ({ i, v }));
  const config = { v: { label: '', color } } satisfies ChartConfig;
  const id = `spark-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <ChartContainer config={config} className="aspect-auto h-10 w-full" aria-hidden>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-v)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-v)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide reversed />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Area dataKey="v" type="monotone" stroke="var(--color-v)" strokeWidth={1.75} fill={`url(#${id})`} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}
