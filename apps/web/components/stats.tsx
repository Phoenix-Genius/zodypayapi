import { formatAmount, formatMoney } from '@/lib/format';
import type { Stats } from '@/lib/types';
import { Card } from './ui';

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="!p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export function StatsPanel({ stats }: { stats: Stats }) {
  const volume = stats.volume.map((v) => formatMoney(v.amount, v.currency)).join(' · ') || '—';
  const settled = stats.settled.map((s) => `${formatAmount(s.amount, 6)} ${s.coin}`).join(' · ') || '—';
  const max = Math.max(1, ...stats.daily.map((d) => d.created));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Payments (30d)" value={String(stats.total)} />
        <Tile label="Paid" value={String(stats.paid)} sub={`${stats.conversion}% conversion`} />
        <Tile label="Invoiced volume" value={volume} />
        <Tile label="Settled to you" value={settled} />
      </div>
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Daily payments</p>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-brand/30" /> Created
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-brand" /> Paid
            </span>
          </div>
        </div>
        {stats.daily.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No payments in this period yet.</p>
        ) : (
          <div className="mt-4 flex h-40 items-end gap-1">
            {stats.daily.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.paid}/${d.created} paid`}>
                <div className="relative w-full rounded-t bg-brand/30" style={{ height: `${(d.created / max) * 100}%` }}>
                  <div className="absolute inset-x-0 bottom-0 rounded-t bg-brand" style={{ height: `${d.created ? (d.paid / d.created) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
