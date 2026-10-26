/**
 * Every provider names networks differently. We normalise to SideShift-style lowercase ids
 * and keep a per-provider alias table. Networks missing here are ignored rather than guessed.
 */
export const NETWORKS: Record<string, { name: string; explorerTx?: string }> = {
  bitcoin: { name: 'Bitcoin', explorerTx: 'https://mempool.space/tx/' },
  ethereum: { name: 'Ethereum', explorerTx: 'https://etherscan.io/tx/' },
  tron: { name: 'Tron', explorerTx: 'https://tronscan.org/#/transaction/' },
  bsc: { name: 'BNB Smart Chain', explorerTx: 'https://bscscan.com/tx/' },
  solana: { name: 'Solana', explorerTx: 'https://solscan.io/tx/' },
  polygon: { name: 'Polygon', explorerTx: 'https://polygonscan.com/tx/' },
  arbitrum: { name: 'Arbitrum', explorerTx: 'https://arbiscan.io/tx/' },
  optimism: { name: 'Optimism', explorerTx: 'https://optimistic.etherscan.io/tx/' },
  base: { name: 'Base', explorerTx: 'https://basescan.org/tx/' },
  avax: { name: 'Avalanche C-Chain', explorerTx: 'https://snowtrace.io/tx/' },
  litecoin: { name: 'Litecoin', explorerTx: 'https://litecoinspace.org/tx/' },
  dogecoin: { name: 'Dogecoin', explorerTx: 'https://blockchair.com/dogecoin/transaction/' },
  bitcoincash: { name: 'Bitcoin Cash', explorerTx: 'https://blockchair.com/bitcoin-cash/transaction/' },
  monero: { name: 'Monero' },
  ripple: { name: 'XRP Ledger', explorerTx: 'https://xrpscan.com/tx/' },
  ton: { name: 'TON', explorerTx: 'https://tonviewer.com/transaction/' },
  cardano: { name: 'Cardano', explorerTx: 'https://cardanoscan.io/transaction/' },
  zksyncera: { name: 'zkSync Era', explorerTx: 'https://explorer.zksync.io/tx/' },
  linea: { name: 'Linea', explorerTx: 'https://lineascan.build/tx/' },
};

type AliasTable = Record<string, string>;

const SIDESHIFT: AliasTable = Object.fromEntries(Object.keys(NETWORKS).map((n) => [n, n]));

const CHANGENOW: AliasTable = {
  btc: 'bitcoin',
  eth: 'ethereum',
  trx: 'tron',
  bsc: 'bsc',
  sol: 'solana',
  matic: 'polygon',
  arbitrum: 'arbitrum',
  op: 'optimism',
  base: 'base',
  avaxc: 'avax',
  ltc: 'litecoin',
  doge: 'dogecoin',
  bch: 'bitcoincash',
  xmr: 'monero',
  xrp: 'ripple',
  ton: 'ton',
  ada: 'cardano',
  zksync: 'zksyncera',
  linea: 'linea',
};

const FIXEDFLOAT: AliasTable = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  TRX: 'tron',
  TRON: 'tron',
  BSC: 'bsc',
  SOL: 'solana',
  MATIC: 'polygon',
  POL: 'polygon',
  ARBITRUM: 'arbitrum',
  ARB: 'arbitrum',
  OP: 'optimism',
  OPTIMISM: 'optimism',
  BASE: 'base',
  AVAXC: 'avax',
  LTC: 'litecoin',
  DOGE: 'dogecoin',
  BCH: 'bitcoincash',
  XMR: 'monero',
  XRP: 'ripple',
  TON: 'ton',
  ADA: 'cardano',
  ZKSYNC: 'zksyncera',
  LINEA: 'linea',
};

export const NETWORK_ALIASES = { sideshift: SIDESHIFT, changenow: CHANGENOW, fixedfloat: FIXEDFLOAT };

export function toCanonical(table: AliasTable, providerNetwork: string): string | null {
  return table[providerNetwork] ?? null;
}

export function fromCanonical(table: AliasTable, network: string): string | null {
  for (const [alias, canonical] of Object.entries(table)) if (canonical === network) return alias;
  return null;
}

export function explorerTxUrl(network: string, hash: string | null): string | null {
  const base = NETWORKS[network]?.explorerTx;
  return base && hash ? base + hash : null;
}
