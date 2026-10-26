import { requestJson, type FetchFn } from './http.js';
import { NETWORK_ALIASES, fromCanonical, toCanonical } from './networks.js';
import { ProviderError, type ProviderAsset, type SwapProvider, type SwapState } from './types.js';
import type { SwapStatus } from '../db/schema.js';
import { Decimal, fmt } from '../lib/money.js';

// ChangeNOW API v2, fixed-rate "reverse" flow (we specify the amount the merchant receives).
// Partner fee is configured on the ChangeNOW partner dashboard, not per request.
const BASE = 'https://api.changenow.io/v2';
const ID = 'changenow';

interface CnCurrency {
  ticker: string;
  name: string;
  network: string;
  hasExternalId?: boolean;
  supportsFixedRate?: boolean;
  buy?: boolean;
  sell?: boolean;
  isFiat?: boolean;
}
interface CnEstimate {
  fromAmount: number | string;
  toAmount: number | string;
  rateId: string | null;
  validUntil: string | null;
}
interface CnExchange {
  id: string;
  payinAddress: string;
  payinExtraId?: string | null;
  fromAmount: number | string;
  toAmount: number | string;
}
interface CnStatus {
  id: string;
  status: string;
  payinHash?: string | null;
  payoutHash?: string | null;
  amountTo?: number | string | null;
}

const STATUS: Record<string, SwapStatus> = {
  new: 'AWAITING_DEPOSIT',
  waiting: 'AWAITING_DEPOSIT',
  confirming: 'CONFIRMING',
  exchanging: 'EXCHANGING',
  sending: 'EXCHANGING',
  verifying: 'ON_HOLD',
  finished: 'SETTLED',
  failed: 'FAILED',
  refunded: 'REFUNDED',
  expired: 'EXPIRED',
};

export function createChangeNowProvider(opts: { apiKey: string; fetch?: FetchFn }): SwapProvider {
  const f = opts.fetch ?? fetch;
  const aliases = NETWORK_ALIASES.changenow;
  const headers = { 'content-type': 'application/json', 'x-changenow-api-key': opts.apiKey };
  const net = (canonical: string) => {
    const n = fromCanonical(aliases, canonical);
    if (!n) throw new ProviderError(ID, 'unsupported', `Network ${canonical} not supported`);
    return n;
  };

  return {
    id: ID,
    name: 'ChangeNOW',
    trackingUrl: (id) => `https://changenow.io/exchange/txs/${id}`,

    async listAssets() {
      const list = await requestJson<CnCurrency[]>(
        f,
        ID,
        `${BASE}/exchange/currencies?active=true&flow=fixed-rate`,
        { headers },
      );
      const out: ProviderAsset[] = [];
      for (const c of list) {
        const network = toCanonical(aliases, c.network);
        if (!network || c.isFiat || c.supportsFixedRate === false) continue;
        out.push({
          coin: c.ticker.toUpperCase(),
          network,
          name: c.name,
          hasMemo: !!c.hasExternalId,
          canDeposit: c.sell !== false,
          canSettle: c.buy !== false,
        });
      }
      return out;
    },

    async quote({ from, to, settleAmount }) {
      const qs = new URLSearchParams({
        fromCurrency: from.coin.toLowerCase(),
        toCurrency: to.coin.toLowerCase(),
        fromNetwork: net(from.network),
        toNetwork: net(to.network),
        toAmount: settleAmount,
        flow: 'fixed-rate',
        type: 'reverse',
        useRateId: 'true',
      });
      const e = await requestJson<CnEstimate>(f, ID, `${BASE}/exchange/estimated-amount?${qs}`, { headers }).catch(
        (err: ProviderError) => {
          throw err.kind === 'rejected' ? new ProviderError(ID, 'unsupported', err.message) : err;
        },
      );
      if (!e.rateId) throw new ProviderError(ID, 'unsupported', 'No fixed rate available');
      const deposit = String(e.fromAmount);
      return {
        provider: ID,
        from,
        to,
        depositAmount: deposit,
        settleAmount: String(e.toAmount),
        rate: fmt(new Decimal(String(e.toAmount)).div(deposit).toDecimalPlaces(12)),
        expiresAt: e.validUntil ?? new Date(Date.now() + 10 * 60_000).toISOString(),
        context: { rateId: e.rateId },
      };
    },

    async createSwap({ quote, settleAddress, settleMemo, refundAddress, externalId }) {
      const x = await requestJson<CnExchange>(f, ID, `${BASE}/exchange`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fromCurrency: quote.from.coin.toLowerCase(),
          toCurrency: quote.to.coin.toLowerCase(),
          fromNetwork: net(quote.from.network),
          toNetwork: net(quote.to.network),
          fromAmount: '',
          toAmount: quote.settleAmount,
          address: settleAddress,
          extraId: settleMemo ?? '',
          refundAddress: refundAddress ?? '',
          refundExtraId: '',
          userId: '',
          payload: externalId,
          contactEmail: '',
          flow: 'fixed-rate',
          type: 'reverse',
          rateId: quote.context.rateId,
        }),
      });
      return {
        providerOrderId: x.id,
        providerToken: null,
        depositAddress: x.payinAddress,
        depositMemo: x.payinExtraId || null,
        depositAmount: String(x.fromAmount),
        settleAmount: String(x.toAmount),
        expiresAt: quote.expiresAt,
        providerStatus: 'new',
        raw: x,
      };
    },

    async getSwap({ providerOrderId }): Promise<SwapState> {
      const s = await requestJson<CnStatus>(
        f,
        ID,
        `${BASE}/exchange/by-id?id=${encodeURIComponent(providerOrderId)}`,
        { headers },
      );
      const status = STATUS[s.status] ?? 'EXCHANGING';
      return {
        status,
        providerStatus: s.status,
        depositTxHash: s.payinHash ?? null,
        settleTxHash: s.payoutHash ?? null,
        settledAmount: status === 'SETTLED' && s.amountTo != null ? String(s.amountTo) : null,
        raw: s,
      };
    },
  };
}
