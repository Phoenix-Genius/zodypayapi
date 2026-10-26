'use client';

import Link from 'next/link';
import { useSession } from '@/components/app-shell';
import { StatsPanel } from '@/components/stats';
import { ButtonLink, Card, Empty, PageHeader, Spinner } from '@/components/ui';
import { useApi } from '@/lib/api';
import type { AppInfo, Stats } from '@/lib/types';

export default function Overview() {
  const { mode } = useSession();
  const overview = useApi<{ app_count: number; stats: Stats }>(`/dashboard/overview?mode=${mode}`);
  const apps = useApi<{ data: AppInfo[] }>('/dashboard/apps');

  return (
    <>
      <PageHeader title="Overview" subtitle={`All apps · last 30 days · ${mode} mode`} actions={<ButtonLink href="/dashboard/apps/new">New app</ButtonLink>} />
      {overview.loading && <Spinner />}
      {overview.data && <StatsPanel stats={overview.data.stats} />}

      <h2 className="mb-3 mt-10 text-lg font-semibold">Your apps</h2>
      {apps.data && apps.data.data.length === 0 && (
        <Empty title="No apps yet">
          Create an app to get API keys and a checkout.{' '}
          <Link className="text-brand" href="/dashboard/apps/new">
            Create your first app →
          </Link>
        </Empty>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.data?.data.map((a) => (
          <Link key={a.id} href={`/dashboard/apps/${a.id}`}>
            <Card className="transition hover:border-brand/50">
              <p className="font-medium">{a.name}</p>
              <p className="mt-1 text-sm text-muted">
                Settles in {a.settle_coin} on {a.settle_network}
              </p>
              <p className="mt-3 font-mono text-xs text-muted">{a.id}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
