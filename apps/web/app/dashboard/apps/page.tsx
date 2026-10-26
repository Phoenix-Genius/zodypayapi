'use client';

import Link from 'next/link';
import { ButtonLink, Card, Empty, PageHeader, Spinner } from '@/components/ui';
import { useApi } from '@/lib/api';
import { formatDate, shorten } from '@/lib/format';
import type { AppInfo } from '@/lib/types';

export default function AppsPage() {
  const { data, loading } = useApi<{ data: AppInfo[] }>('/dashboard/apps');
  return (
    <>
      <PageHeader title="Apps" subtitle="Each app has its own API keys, webhook and settlement wallet." actions={<ButtonLink href="/dashboard/apps/new">New app</ButtonLink>} />
      {loading && <Spinner />}
      {data && data.data.length === 0 && <Empty title="No apps yet">Create one to start accepting payments.</Empty>}
      {data && data.data.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Settlement</th>
                  <th className="px-5 py-3 font-medium">Payout address</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-2">
                    <td className="px-5 py-3">
                      <Link className="font-medium hover:text-brand" href={`/dashboard/apps/${a.id}`}>
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      {a.settle_coin} · {a.settle_network}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-muted">{shorten(a.settle_address)}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
