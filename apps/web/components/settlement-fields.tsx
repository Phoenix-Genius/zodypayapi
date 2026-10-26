'use client';

import { useApi } from '@/lib/api';
import type { Asset } from '@/lib/types';
import { Field, Input, Select } from './ui';

export interface SettlementValue {
  settle_coin: string;
  settle_network: string;
  settle_address: string;
  settle_memo: string;
}

/** Settlement asset picker, populated from the provider catalog. */
export function SettlementFields({ value, onChange }: { value: SettlementValue; onChange: (v: SettlementValue) => void }) {
  const { data } = useApi<{ live: Asset[]; test: Asset[] }>('/dashboard/assets');
  // Prefer the live catalog; fall back to test assets when no live providers are configured.
  const assets = data ? (data.live.length ? data.live : data.test) : [];
  const key = `${value.settle_coin}:${value.settle_network}`;
  const selected = assets.find((a) => `${a.coin}:${a.network}` === key);
  const popular = ['USDC', 'USDT', 'BTC', 'ETH', 'SOL'];
  const sorted = [...assets].sort(
    (a, b) =>
      (popular.indexOf(a.coin) + 1 || 99) - (popular.indexOf(b.coin) + 1 || 99) || a.coin.localeCompare(b.coin),
  );

  return (
    <div className="space-y-4">
      <Field label="Settlement currency" hint="The coin and network you want to receive. Stablecoins avoid price risk.">
        <Select
          value={key}
          onChange={(e) => {
            const [coin = '', network = ''] = e.target.value.split(':');
            onChange({ ...value, settle_coin: coin, settle_network: network });
          }}
        >
          {!selected && <option value={key}>{value.settle_coin ? `${value.settle_coin} on ${value.settle_network}` : 'Select…'}</option>}
          {sorted.map((a) => (
            <option key={`${a.coin}:${a.network}`} value={`${a.coin}:${a.network}`}>
              {a.coin} — {a.network_name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Payout address" hint="Your own wallet on that network. Double-check it: payouts cannot be reversed.">
        <Input
          required
          spellCheck={false}
          className="font-mono"
          value={value.settle_address}
          onChange={(e) => onChange({ ...value, settle_address: e.target.value.trim() })}
        />
      </Field>
      {(selected?.has_memo || value.settle_memo) && (
        <Field label="Memo / destination tag" hint="Required by some exchanges and networks.">
          <Input value={value.settle_memo} onChange={(e) => onChange({ ...value, settle_memo: e.target.value })} />
        </Field>
      )}
    </div>
  );
}
