'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Payment } from '@/lib/types';
import { NetworkBadge } from './network-badge';
import { Button, Card, CopyButton, Empty, Input, Select, Spinner, StatusBadge } from './ui';

const STATUSES = ['', 'pending', 'processing', 'paid', 'underpaid', 'expired', 'failed', 'refunded', 'canceled'];

/** Filterable, paginated payment list. `basePath` is the API list endpoint (query string appended). */
export function PaymentsTable({ basePath, detailHref, extraQuery = '' }: { basePath: string; detailHref: (p: Payment) => string; extraQuery?: string }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors[cursors.length - 1];
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (search) qs.set('q', search);
  if (before) qs.set('before', before);
  const sep = basePath.includes('?') ? '&' : '?';
  const { data, loading, error } = useApi<{ data: Payment[]; has_more: boolean; next_before: string | null }>(
    `${basePath}${sep}${qs.toString()}${extraQuery}`,
    10_000,
  );

  return (
    <div className="space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
          setCursors([]);
        }}
      >
        <Input placeholder="Search order id or payment id" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-xs" />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursors([]);
          }}
          className="sm:max-w-[180px]"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s ? s[0]!.toUpperCase() + s.slice(1) : 'All statuses'}
            </option>
          ))}
        </Select>
      </form>
      {loading && !data && <Spinner />}
      {error && <Empty title="Couldn't load payments">{error.message}</Empty>}
      {data && data.data.length === 0 && <Empty title="No payments found" />}
      {data && data.data.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Order</th>
                  <th className="px-5 py-3 font-medium">Paid with</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Checkout link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.data.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2">
                    <td className="px-5 py-3 font-medium tabular-nums">
                      <Link href={detailHref(p)} className="hover:text-brand">
                        {formatMoney(p.amount, p.currency)}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="max-w-[180px] truncate px-5 py-3 text-muted">{p.order_id}</td>
                    <td className="px-5 py-3 text-muted">
                      {p.swap ? (
                        <span className="inline-flex items-center gap-1.5">
                          {p.swap.deposit_coin} <NetworkBadge network={p.swap.deposit_network} />
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-muted">{formatDate(p.created_at)}</td>
                    <td className="whitespace-nowrap px-5 py-3">
                      <span className="flex items-center gap-1.5">
                        <CopyButton value={p.checkout_url} label="Copy" />
                        <a href={p.checkout_url} target="_blank" rel="noreferrer" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text">
                          Open ↗
                        </a>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {(cursors.length > 0 || data?.has_more) && (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!cursors.length} onClick={() => setCursors((c) => c.slice(0, -1))}>
            Newer
          </Button>
          <Button variant="secondary" disabled={!data?.has_more} onClick={() => data?.next_before && setCursors((c) => [...c, data.next_before!])}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
