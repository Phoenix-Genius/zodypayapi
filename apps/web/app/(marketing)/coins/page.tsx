'use client';

import { useMemo, useState } from 'react';
import { NetworkBadge } from '@/components/network-badge';
import { Empty, Input, Spinner } from '@/components/ui';
import { useApi } from '@/lib/api';

interface PublicAsset {
  coin: string;
  network: string;
  name: string;
  network_name: string;
  can_pay: boolean;
  can_settle: boolean;
}

export default function CoinsPage() {
  const { data, loading, error } = useApi<{ livemode: boolean; assets: PublicAsset[] }>('/public/assets');
  const [q, setQ] = useState('');

  const grouped = useMemo(() => {
    const map = new Map<string, { coin: string; name: string; networks: PublicAsset[] }>();
    for (const a of data?.assets ?? []) {
      const term = q.trim().toLowerCase();
      if (term && !`${a.coin} ${a.name} ${a.network_name}`.toLowerCase().includes(term)) continue;
      const g = map.get(a.coin) ?? { coin: a.coin, name: a.name, networks: [] };
      g.networks.push(a);
      map.set(a.coin, g);
    }
    return [...map.values()];
  }, [data, q]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Supported coins</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        Customers can pay with any of these. The list updates automatically from our exchange providers.
      </p>
      {data && !data.livemode && (
        <p className="mt-2 text-sm text-warning">Showing the test-mode catalog — no live providers are configured on this server.</p>
      )}
      <div className="mt-8 max-w-sm">
        <Input placeholder="Search coin or network…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mt-8">
        {loading && <Spinner />}
        {error && <Empty title="Couldn't load the coin list">{error.message}</Empty>}
        {data && !grouped.length && <Empty title="No matches" />}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {grouped.map((g) => (
            <div key={g.coin} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{g.coin}</span>
                <span className="truncate text-sm text-muted">{g.name}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {g.networks.map((n) => (
                  <NetworkBadge key={n.network} network={n.network} title={n.network_name} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
