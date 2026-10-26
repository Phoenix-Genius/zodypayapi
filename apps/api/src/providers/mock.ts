import { randomBytes } from 'node:crypto';
import { randomToken } from '../lib/ids.js';
import { Decimal, fmt } from '../lib/money.js';
import { ProviderError, type ProviderAsset, type SwapProvider, type SwapState } from './types.js';

/** USD prices used by mock providers and by test-mode pricing. */
export const MOCK_USD_PRICES: Record<string, string> = {
  BTC: '65000',
  ETH: '3200',
  SOL: '150',
  LTC: '80',
  TRX: '0.16',
  BNB: '600',
  DOGE: '0.15',
  XRP: '0.6',
  POL: '0.5',
  USDT: '1',
  USDC: '1',
  DAI: '1',
};

const MOCK_ASSETS: Omit<ProviderAsset, 'canDeposit' | 'canSettle'>[] = [
  { coin: 'BTC', network: 'bitcoin', name: 'Bitcoin', hasMemo: false },
  { coin: 'ETH', network: 'ethereum', name: 'Ether', hasMemo: false },
  { coin: 'ETH', network: 'base', name: 'Ether', hasMemo: false },
  { coin: 'SOL', network: 'solana', name: 'Solana', hasMemo: false },
  { coin: 'LTC', network: 'litecoin', name: 'Litecoin', hasMemo: false },
  { coin: 'USDT', network: 'tron', name: 'Tether', hasMemo: false },
  { coin: 'USDT', network: 'ethereum', name: 'Tether', hasMemo: false },
  { coin: 'USDC', network: 'base', name: 'USD Coin', hasMemo: false },
  { coin: 'USDC', network: 'solana', name: 'USD Coin', hasMemo: false },
  { coin: 'USDT', network: 'bsc', name: 'Tether', hasMemo: false },
  { coin: 'BNB', network: 'bsc', name: 'BNB', hasMemo: false },
];

/** More networks for the common coins, so test mode resembles the live catalog. */
const MOCK_EXTRA: Omit<ProviderAsset, 'canDeposit' | 'canSettle'>[] = [
  ...['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'solana', 'avax', 'ton'].map((network) => ({
    coin: 'USDT',
    network,
    name: 'Tether',
    hasMemo: network === 'ton',
  })),
  ...['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'avax', 'tron'].map((network) => ({
    coin: 'USDC',
    network,
    name: 'USD Coin',
    hasMemo: false,
  })),
  { coin: 'DAI', network: 'ethereum', name: 'Dai', hasMemo: false },
  { coin: 'ETH', network: 'arbitrum', name: 'Ether', hasMemo: false },
  { coin: 'ETH', network: 'optimism', name: 'Ether', hasMemo: false },
  { coin: 'TRX', network: 'tron', name: 'Tron', hasMemo: false },
  { coin: 'DOGE', network: 'dogecoin', name: 'Dogecoin', hasMemo: false },
  { coin: 'XRP', network: 'ripple', name: 'XRP', hasMemo: true },
  { coin: 'POL', network: 'polygon', name: 'Polygon', hasMemo: false },
];

/** Refund address that makes a mock swap settle 10% short, to exercise underpayment handling. */
export const MOCK_UNDERPAY_REFUND_ADDRESS = 'MOCK-UNDERPAY';

/**
 * Simulated provider for test mode. Stateless: the order id encodes its creation time and the
 * swap advances through the lifecycle based on elapsed time, so API and worker processes agree.
 */
export function createMockProvider(opts: {
  id: string;
  name: string;
  feeBps: number;
  stageSeconds: number;
  excludeCoins?: string[];
}): SwapProvider {
  const supported = [...MOCK_ASSETS, ...MOCK_EXTRA].filter(
    (a, i, all) => !opts.excludeCoins?.includes(a.coin) && all.findIndex((b) => b.coin === a.coin && b.network === a.network) === i,
  );
  const price = (coin: string) => {
    const p = MOCK_USD_PRICES[coin];
    if (!p) throw new ProviderError(opts.id, 'unsupported', `No price for ${coin}`);
    return new Decimal(p);
  };
  const isSupported = (coin: string, network: string) => supported.some((a) => a.coin === coin && a.network === network);

  return {
    id: opts.id,
    name: opts.name,
    trackingUrl: () => null,

    async listAssets() {
      return supported.map((a) => ({ ...a, canDeposit: true, canSettle: true }));
    },

    async quote({ from, to, settleAmount }) {
      if (!isSupported(from.coin, from.network) || !isSupported(to.coin, to.network)) {
        throw new ProviderError(opts.id, 'unsupported', 'Pair not supported');
      }
      const usd = new Decimal(settleAmount).mul(price(to.coin));
      const deposit = usd.div(price(from.coin)).mul(1 + opts.feeBps / 10_000).toDecimalPlaces(8, Decimal.ROUND_UP);
      return {
        provider: opts.id,
        from,
        to,
        depositAmount: fmt(deposit),
        settleAmount,
        rate: fmt(new Decimal(settleAmount).div(deposit).toDecimalPlaces(12)),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        context: {},
      };
    },

    async createSwap({ quote, refundAddress }) {
      const flag = refundAddress === MOCK_UNDERPAY_REFUND_ADDRESS ? 'u' : 'n';
      return {
        providerOrderId: `mock_${Date.now()}_${flag}_${randomToken(8)}`,
        providerToken: quote.settleAmount,
        depositAddress: mockAddress(quote.from.network),
        depositMemo: null,
        depositAmount: quote.depositAmount,
        settleAmount: quote.settleAmount,
        expiresAt: quote.expiresAt,
        providerStatus: 'waiting',
        raw: { simulated: true },
      };
    },

    async getSwap({ providerOrderId, providerToken }): Promise<SwapState> {
      const [, created, flag] = providerOrderId.split('_');
      const elapsed = (Date.now() - Number(created)) / 1000;
      const stage = opts.stageSeconds <= 0 ? 3 : Math.floor(elapsed / opts.stageSeconds);
      const hash = (n: string) => `0xmock${n}${providerOrderId.slice(-8)}`;
      const base = { depositTxHash: null, settleTxHash: null, settledAmount: null, raw: { elapsed } };
      if (stage === 0) return { ...base, status: 'AWAITING_DEPOSIT', providerStatus: 'waiting' };
      if (stage === 1) return { ...base, status: 'CONFIRMING', providerStatus: 'pending', depositTxHash: hash('d') };
      if (stage === 2) return { ...base, status: 'EXCHANGING', providerStatus: 'processing', depositTxHash: hash('d') };
      const settled = new Decimal(providerToken ?? '0').mul(flag === 'u' ? 0.9 : 1);
      return {
        ...base,
        status: 'SETTLED',
        providerStatus: 'settled',
        depositTxHash: hash('d'),
        settleTxHash: hash('s'),
        settledAmount: fmt(settled),
      };
    },
  };
}

function mockAddress(network: string): string {
  const hex = randomBytes(20).toString('hex');
  if (network === 'bitcoin') return `tb1qmock${hex.slice(0, 30)}`;
  if (network === 'litecoin') return `tltc1qmock${hex.slice(0, 28)}`;
  if (network === 'tron') return `TMock${randomToken(29)}`;
  if (network === 'solana') return `Mock${randomToken(40)}`;
  return `0x${hex}`;
}
