'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { formatAmount, formatDate, formatMoney } from '@/lib/format';
import type { PaymentDetail as Detail } from '@/lib/types';
import { DeliveriesTable } from './deliveries-table';
import { Badge, Button, Card, CopyButton, Empty, KeyValue, PageHeader, Spinner, StatusBadge } from './ui';

const ext = (href: string | null, label: string) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-brand hover:underline">
      {label}
    </a>
  ) : (
    label
  );

export function PaymentDetailView({ path, backHref, appId, admin }: { path: string; backHref: string; appId?: string; admin?: boolean }) {
  const { data, error, reload } = useApi<Detail>(path, 10_000);
  const [polling, setPolling] = useState<string | null>(null);

  if (error) return <Empty title="Payment not found">{error.message}</Empty>;
  if (!data) return <Spinner />;
  const { payment: p, swaps, events, deliveries } = data;

  return (
    <>
      <Link href={backHref} className="mb-4 inline-block text-sm text-muted hover:text-text">
        ← Back
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {formatMoney(p.amount, p.currency)} <StatusBadge status={p.status} />
            {!p.livemode && <Badge tone="warning">Test</Badge>}
          </span>
        }
        subtitle={
          <span className="flex items-center gap-2 font-mono text-xs">
            {p.id} <CopyButton value={p.id} />
          </span>
        }
        actions={
          <a href={`/p/${p.id}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
            Open checkout ↗
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <p className="mb-2 font-medium">Payment</p>
          <KeyValue
            rows={[
              ['Order', p.order_id],
              ['Description', p.description ?? '—'],
              ['Created', formatDate(p.created_at)],
              ['Expires', formatDate(p.expires_at)],
              ['Paid', formatDate(p.paid_at)],
              ...(admin && p.app_id ? ([['App', <span key="app" className="font-mono text-xs">{p.app_id}</span>]] as [string, React.ReactNode][]) : []),
              ...Object.entries(p.metadata).map(([k, v]) => [`metadata.${k}`, v] as [string, React.ReactNode]),
            ]}
          />
        </Card>
        <Card>
          <p className="mb-2 font-medium">Settlement</p>
          <KeyValue
            rows={[
              ['Asset', `${p.settlement.coin} on ${p.settlement.network}`],
              ['Expected', `${formatAmount(p.settlement.expected_amount)} ${p.settlement.coin}`],
              ['Received', p.settlement.received_amount ? `${formatAmount(p.settlement.received_amount)} ${p.settlement.coin}` : '—'],
              ['Address', <span key="a" className="font-mono text-xs">{p.settlement.address}</span>],
              ['Payout tx', p.settlement.tx_hash ? ext(p.settlement.tx_url, p.settlement.tx_hash) : '—'],
            ]}
          />
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Swaps</h2>
      {swaps.length === 0 && <Empty title="The customer hasn't chosen a coin yet" />}
      <div className="space-y-4">
        {swaps.map((s) => (
          <Card key={s.id}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {formatAmount(s.deposit_amount)} {s.deposit_coin} <span className="text-muted">({s.deposit_network})</span> via {s.provider_name}
              </p>
              <div className="flex items-center gap-2">
                <StatusBadge status={s.status} />
                {admin && (
                  <Button
                    variant="ghost"
                    className="!h-8"
                    loading={polling === s.id}
                    onClick={async () => {
                      setPolling(s.id);
                      await api(`/admin/swaps/${s.id}/poll`, { method: 'POST' }).catch(() => undefined);
                      setPolling(null);
                      reload();
                    }}
                  >
                    Poll now
                  </Button>
                )}
              </div>
            </div>
            <KeyValue
              rows={[
                ['Provider order', s.tracking_url ? ext(s.tracking_url, s.provider_order_id ?? '') : (s.provider_order_id ?? '—')],
                ['Provider status', s.provider_status ?? '—'],
                ['Deposit address', <span key="d" className="font-mono text-xs">{s.deposit_address}{s.deposit_memo ? ` (memo ${s.deposit_memo})` : ''}</span>],
                ['Rate', s.rate],
                ['Quote expires', formatDate(s.quote_expires_at)],
                ['Deposit tx', s.deposit_tx_hash ? ext(s.deposit_tx_url, s.deposit_tx_hash) : '—'],
                ['Settled', s.settled_amount ? `${formatAmount(s.settled_amount)} ${p.settlement.coin}` : '—'],
              ]}
            />
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Events</h2>
          <Card>
            {events.length === 0 ? (
              <p className="text-sm text-muted">No events yet.</p>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                    <div>
                      <p className="font-mono text-xs">{e.type}</p>
                      <p className="text-xs text-muted">{formatDate(e.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Webhook deliveries</h2>
          {deliveries.length === 0 ? <Empty title="No deliveries" /> : <DeliveriesTable appId={appId} rows={deliveries} onResent={reload} />}
        </div>
      </div>
    </>
  );
}
