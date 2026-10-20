import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';

export interface StatsChartPoint { key: string; label: string; collections: number; expenses: number }

/**
 * The overview's money chart on shadcn/ui's chart (recharts; user 2026-10-21). Its own file, loaded on demand: only the
 * owner and the accountant, who see it, download recharts. Time runs right to left as Arabic reads (oldest by the
 * amounts axis, on the right); every bar's amount is in its tooltip, and screen readers get the same numbers as a table.
 */
export default function StatsChart({ points, labels, format, axisFormat }: {
  points: StatsChartPoint[];
  labels: { collections: string; expenses: string; title: string };
  format: (minor: number) => string;
  axisFormat: (minor: number) => string;
}) {
  const config = {
    collections: { label: labels.collections, color: 'var(--primary-500)' },
    expenses: { label: labels.expenses, color: 'var(--chart-expense, #f59e0b)' },
  } satisfies ChartConfig;
  return (
    <figure className="ov-chart">
      <ChartContainer config={config} className="aspect-auto h-[260px] w-full" aria-hidden>
        <BarChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" reversed tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis orientation="right" tickLine={false} axisLine={false} width={64} tickFormatter={axisFormat} />
          <ChartTooltip cursor={{ fill: 'var(--surface)' }}
            content={<ChartTooltipContent formatter={(value, name) => (
              <span className="flex w-full items-center justify-between gap-4">
                <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
                <bdi className="font-semibold tabular-nums">{format(Number(value))}</bdi>
              </span>
            )} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="collections" fill="var(--color-collections)" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>{labels.title}</caption>
        <thead><tr><th scope="col" /><th scope="col">{labels.collections}</th><th scope="col">{labels.expenses}</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.key}><th scope="row">{p.label}</th><td>{format(p.collections)}</td><td>{format(p.expenses)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
