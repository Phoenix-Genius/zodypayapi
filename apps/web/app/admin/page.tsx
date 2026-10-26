'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DeliveriesTable } from '@/components/deliveries-table';
import { Alert, Badge, Button, Card, Empty, Input, PageHeader, Spinner, StatusBadge } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Delivery } from '@/lib/types';

interface ProviderRow {
  id: string;
  name: string;
  livemode: boolean;
  enabled: boolean;
  priority: number;
  breaker_open_until: string | null;
  last_error: string | null;
  last_error_at: string | null;
  swaps_7d: Record<string, number>;
  success_rate_7d: number | null;
}

interface Overview {
  users: number;
  apps: number;
  payments_24h: { mode: string; status: string; count: number }[];
  failed_webhooks: number;
  attention_swaps: { id: string; payment_id: string; provider: string; status: string; provider_status: string; updated_at: string }[];
  providers: ProviderRow[];
}

export default function AdminOverview() {
  const { data, reload } = useApi<Overview>('/admin/overview', 20_000);
  const failed = useApi<{ data: Delivery[] }>('/admin/deliveries?status=failed');
  const [msg, setMsg] = useState<string | null>(null);

  if (!data) return <Spinner />;
  const live24 = data.payments_24h.filter((p) => p.mode === 'live');
  const sum = (rows: typeof live24, statuses?: string[]) =>
    rows.filter((r) => !statuses || statuses.includes(r.status)).reduce((s, r) => s + r.count, 0);

  async function patch(id: string, body: object) {
    await api(`/admin/providers/${id}`, { method: 'PATCH', body });
    reload();
  }

  return (
    <>
      <PageHeader
        title="Platform"
        subtitle="Health, providers and activity"
        actions={
          <Button
            variant="secondary"
            onClick={async () => {
              const r = await api<{ live: number; test: number }>('/admin/providers/refresh-assets', { method: 'POST' });
              setMsg(`Asset catalog refreshed: ${r.live} live, ${r.test} test assets`);
            }}
          >
            Refresh asset catalog
          </Button>
        }
      />
      {msg && <div className="mb-4"><Alert tone="success">{msg}</Alert></div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Merchants', data.users],
          ['Apps', data.apps],
          ['Live payments (24h)', `${sum(live24, ['paid', 'underpaid'])} / ${sum(live24)} paid`],
          ['Failed webhooks', data.failed_webhooks],
        ].map(([label, value]) => (
          <Card key={String(label)} className="!p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Exchange providers</h2>
      <div className="space-y-3">
        {data.providers.map((p) => (
          <ProviderCard key={p.id} p={p} onPatch={(body) => patch(p.id, body)} />
        ))}
        {!data.providers.some((p) => p.livemode) && (
          <Alert tone="warning">No live providers configured. Add SIDESHIFT_SECRET / CHANGENOW_API_KEY / FIXEDFLOAT_API_KEY to the API environment.</Alert>
        )}
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Swaps needing attention</h2>
      {data.attention_swaps.length === 0 ? (
        <Empty title="Nothing on hold, refunding or failed" />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {data.attention_swaps.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-5 py-3">{s.provider}</td>
                    <td className="px-5 py-3 text-muted">{s.provider_status}</td>
                    <td className="px-5 py-3">
                      <Link className="font-mono text-xs text-brand" href={`/admin/payments/${s.payment_id}`}>{s.payment_id}</Link>
                    </td>
                    <td className="px-5 py-3 text-muted">{formatDate(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <h2 className="mb-3 mt-10 text-lg font-semibold">Failed webhook deliveries</h2>
      {failed.data && failed.data.data.length === 0 && <Empty title="No failed deliveries" />}
      {failed.data && failed.data.data.length > 0 && <DeliveriesTable rows={failed.data.data} />}
    </>
  );
}

function ProviderCard({ p, onPatch }: { p: ProviderRow; onPatch: (body: object) => Promise<void> }) {
  const [priority, setPriority] = useState(String(p.priority));
  const [busy, setBusy] = useState(false);
  const run = async (body: object) => {
    setBusy(true);
    await onPatch(body).catch(() => undefined);
    setBusy(false);
  };
  return (
    <Card className="!p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name}</span>
            <Badge tone={p.livemode ? 'brand' : 'neutral'}>{p.livemode ? 'live' : 'test'}</Badge>
            {!p.enabled && <Badge tone="warning">disabled</Badge>}
            {p.breaker_open_until && <Badge tone="warning">circuit open until {new Date(p.breaker_open_until).toLocaleTimeString()}</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted">
            7d: {Object.entries(p.swaps_7d).map(([k, v]) => `${v} ${k}`).join(', ') || 'no swaps'}
            {p.success_rate_7d != null && ` · ${p.success_rate_7d}% success`}
          </p>
          {p.last_error && (
            <p className="mt-1 truncate text-xs text-danger" title={p.last_error}>
              Last error {formatDate(p.last_error_at)}: {p.last_error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Priority
            <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} onBlur={() => run({ priority: Number(priority) })} className="!h-8 w-20" />
          </label>
          {p.breaker_open_until && (
            <Button variant="secondary" className="!h-8" loading={busy} onClick={() => run({ reset_breaker: true })}>
              Reset breaker
            </Button>
          )}
          <Button variant={p.enabled ? 'secondary' : 'primary'} className="!h-8" loading={busy} onClick={() => run({ enabled: !p.enabled })}>
            {p.enabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
