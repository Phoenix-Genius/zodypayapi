'use client';

import { useState } from 'react';
import { networkMeta } from '@/lib/networks';

const coinSrc = (coin: string) => `/crypto/coins/${encodeURIComponent(coin.toUpperCase())}.svg`;
const networkSrc = (network: string) => `/crypto/networks/${encodeURIComponent(network)}.svg`;

/** Network logo on a white disc; renders nothing if we have no logo for the network. */
export function NetworkLogo({ network, size = 16, className = '' }: { network: string; size?: number; className?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    <img
      src={networkSrc(network)}
      alt=""
      width={size}
      height={size}
      onError={() => setMissing(true)}
      className={`shrink-0 rounded-full bg-white p-px ${className}`}
    />
  );
}

/** Network logo plus a colored tag, e.g. [logo] TRX. */
export function NetworkBadge({ network, title }: { network: string; title?: string }) {
  const { tag, color } = networkMeta(network);
  return (
    <span
      title={title ?? network}
      className="inline-flex items-center gap-1 rounded py-px pl-px pr-1.5 text-[10px] font-bold leading-4 tracking-wide text-white"
      style={{ backgroundColor: color }}
    >
      <NetworkLogo network={network} size={14} />
      {tag}
    </span>
  );
}

/** Coin logo with the network logo in the corner; falls back to the ticker when no logo exists. */
export function CoinIcon({ coin, network, size = 36 }: { coin: string; network: string; size?: number }) {
  const [missing, setMissing] = useState(false);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {missing ? (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand">
          {coin.slice(0, 4)}
        </span>
      ) : (
        <img
          src={coinSrc(coin)}
          alt={coin}
          width={size}
          height={size}
          onError={() => setMissing(true)}
          className="h-full w-full rounded-full bg-white p-1 ring-1 ring-border"
        />
      )}
      <NetworkLogo network={network} size={Math.round(size * 0.45)} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-surface" />
    </span>
  );
}
