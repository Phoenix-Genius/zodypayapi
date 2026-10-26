/** Short tag and brand color per network id (matches the API's canonical network ids). */
export const NETWORK_META: Record<string, { tag: string; color: string }> = {
  bitcoin: { tag: 'BTC', color: '#f7931a' },
  ethereum: { tag: 'ETH', color: '#627eea' },
  tron: { tag: 'TRX', color: '#eb0029' },
  bsc: { tag: 'BSC', color: '#d9a20b' },
  solana: { tag: 'SOL', color: '#9945ff' },
  polygon: { tag: 'POL', color: '#8247e5' },
  arbitrum: { tag: 'ARB', color: '#2d74da' },
  optimism: { tag: 'OP', color: '#ff0420' },
  base: { tag: 'BASE', color: '#0052ff' },
  avax: { tag: 'AVAX', color: '#e84142' },
  litecoin: { tag: 'LTC', color: '#345d9d' },
  dogecoin: { tag: 'DOGE', color: '#ba9f33' },
  bitcoincash: { tag: 'BCH', color: '#0ac18e' },
  monero: { tag: 'XMR', color: '#f26822' },
  ripple: { tag: 'XRP', color: '#23292f' },
  ton: { tag: 'TON', color: '#0098ea' },
  cardano: { tag: 'ADA', color: '#0033ad' },
  zksyncera: { tag: 'ZKSYNC', color: '#4e529a' },
  linea: { tag: 'LINEA', color: '#121212' },
};

export function networkMeta(network: string) {
  return NETWORK_META[network] ?? { tag: network.toUpperCase().slice(0, 6), color: '#64647a' };
}
