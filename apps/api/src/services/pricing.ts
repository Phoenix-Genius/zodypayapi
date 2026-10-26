import type { Ctx } from '../context.js';
import type { Mode } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import { Decimal, fmt } from '../lib/money.js';
import { MOCK_USD_PRICES } from '../providers/mock.js';

export const FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'SGD', 'BRL', 'INR'] as const;

/** Stablecoins treated as 1:1 with their fiat currency. */
const PEGGED: Record<string, string[]> = {
  USD: ['USDT', 'USDC', 'DAI', 'USDS', 'PYUSD', 'FDUSD', 'TUSD', 'USDE', 'USD1'],
  EUR: ['EURC', 'EURT', 'EURS'],
};

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  LTC: 'litecoin',
  XMR: 'monero',
  TRX: 'tron',
  BNB: 'binancecoin',
  DOGE: 'dogecoin',
  XRP: 'ripple',
  TON: 'the-open-network',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  POL: 'polygon-ecosystem-token',
  BCH: 'bitcoin-cash',
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
};

const MOCK_FIAT_USD: Record<string, string> = { USD: '1', EUR: '1.08', GBP: '1.27' };

const isFiat = (c: string) => (FIAT_CURRENCIES as readonly string[]).includes(c);
const isStable = (coin: string) => Object.values(PEGGED).some((l) => l.includes(coin));

/** Price of one `coin` in `vs` (fiat). */
async function priceIn(ctx: Ctx, mode: Mode, coin: string, vs: string): Promise<Decimal> {
  if (mode === 'TEST') {
    const usd = MOCK_USD_PRICES[coin];
    const fx = MOCK_FIAT_USD[vs];
    if (!usd || !fx) throw badRequest(`No test price for ${coin}/${vs}`);
    return new Decimal(usd).div(fx);
  }
  const id = COINGECKO_IDS[coin];
  if (!id) throw badRequest(`Cannot price ${coin}; invoice in ${coin} or settle in a stablecoin`);
  const cacheKey = `price:${id}:${vs}`;
  const cached = await ctx.kv.get(cacheKey);
  if (cached) return new Decimal(cached);

  const vsLower = vs.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vsLower}`;
  const headers: Record<string, string> = ctx.config.COINGECKO_API_KEY
    ? { 'x-cg-demo-api-key': ctx.config.COINGECKO_API_KEY }
    : {};
  const res = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Price feed returned HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, Record<string, number>>;
  const value = body[id]?.[vsLower];
  if (value == null) throw badRequest(`No price available for ${coin}/${vs}`);
  // JSON numbers are converted via their string form to avoid binary float artifacts.
  const price = new Decimal(String(value));
  await ctx.kv.set(cacheKey, price.toString(), 60);
  return price;
}

/**
 * Converts an invoice amount into the amount of `settleCoin` the merchant must receive.
 * Stablecoins pegged to the invoice currency convert 1:1; everything else uses a price feed.
 */
export async function computeSettleAmount(
  ctx: Ctx,
  p: { amount: string; currency: string; settleCoin: string; mode: Mode },
): Promise<string> {
  const amount = new Decimal(p.amount);
  const dp = isStable(p.settleCoin) ? 6 : 8;
  let result: Decimal;
  if (p.currency === p.settleCoin || PEGGED[p.currency]?.includes(p.settleCoin)) {
    result = amount;
  } else if (isFiat(p.currency)) {
    result = amount.div(await priceIn(ctx, p.mode, p.settleCoin, p.currency));
  } else {
    // Crypto-denominated invoice settled in another coin: cross via USD.
    const from = isStable(p.currency) ? new Decimal(1) : await priceIn(ctx, p.mode, p.currency, 'USD');
    const to = isStable(p.settleCoin) ? new Decimal(1) : await priceIn(ctx, p.mode, p.settleCoin, 'USD');
    result = amount.mul(from).div(to);
  }
  return fmt(result.toDecimalPlaces(dp, Decimal.ROUND_UP));
}
