'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Delivery } from '@/lib/types';
import { Button, Card, StatusBadge } from './ui';

/** Webhook delivery log. Pass `appId` to enable resending through the merchant API. */
export function DeliveriesTable({ appId, rows, onResent }: { appId?: string; rows: Delivery[]; onResent?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Event</th>
              <th className="px-5 py-3 font-medium">Attempts</th>
              <th className="px-5 py-3 font-medium">Last response</th>
              <th className="px-5 py-3 font-medium">Created</th>
              {appId && <th className="px-5 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="px-5 py-3">
                  <StatusBadge status={d.status} />
                </td>
                <td className="px-5 py-3 font-mono text-xs text-muted">{d.event_id}</td>
                <td className="px-5 py-3 tabular-nums">{d.attempts}</td>
                <td className="max-w-[220px] truncate px-5 py-3 text-muted" title={d.last_error ?? ''}>
                  {d.last_status_code ?? d.last_error ?? '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-muted">{formatDate(d.created_at)}</td>
                {appId && (
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="ghost"
                      className="!h-8"
                      loading={busy === d.id}
                      onClick={async () => {
                        setBusy(d.id);
                        await api(`/dashboard/apps/${appId}/deliveries/${d.id}/resend`, { method: 'POST' }).catch(() => undefined);
                        setBusy(null);
                        onResent?.();
                      }}
                    >
                      Resend
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
