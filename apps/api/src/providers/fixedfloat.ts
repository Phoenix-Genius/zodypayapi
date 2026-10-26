import { hmacSha256Hex } from '../lib/crypto.js';
import { Decimal, fmt } from '../lib/money.js';
import { requestJson, type FetchFn } from './http.js';
import { NETWORK_ALIASES, toCanonical } from './networks.js';
import { ProviderError, type AssetRef, type ProviderAsset, type SwapProvider, type SwapState } from './types.js';
import type { SwapStatus } from '../db/schema.js';

// FixedFloat API v2: every call is a signed POST to /api/v2/<method>.
// X-API-SIGN = HMAC-SHA256(secret, raw JSON body). Currencies use composite codes (e.g. USDTTRC),
// so we resolve (coin, network) through the ccies list.
const BASE = 'https://ff.io/api/v2';
const ID = 'fixedfloat';

interface FfEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}
interface FfCcy {
  code: string;
  coin: string;
  network: string;
  name: string;
  recv: boolean | number;
  send: boolean | number;
  tag: string | null;
}
interface FfSide {
  code: string;
  amount: string;
  address?: string;
  tag?: string | null;
  tx?: { id: string | null; amount?: string | null } | null;
}
interface FfPrice {
  from: FfSide;
  to: FfSide;
  errors: string[];
}
interface FfOrder {
  id: string;
  token: string;
  status: string;
  time: { expiration: number };
  from: FfSide;
  to: FfSide;
}

const STATUS: Record<string, SwapStatus> = {
  NEW: 'AWAITING_DEPOSIT',
  PENDING: 'CONFIRMING',
  EXCHANGE: 'EXCHANGING',
  WITHDRAW: 'EXCHANGING',
  DONE: 'SETTLED',
  EXPIRED: 'EXPIRED',
  EMERGENCY: 'ON_HOLD',
};

export function createFixedFloatProvider(opts: {
  apiKey: string;
  apiSecret: string;
  refcode?: string;
  afftax?: number;
  fetch?: FetchFn;
}): SwapProvider {
  const f = opts.fetch ?? fetch;
  let ccyCache: { at: number; list: FfCcy[] } | null = null;

  async function call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify(payload);
    const res = await requestJson<FfEnvelope<T>>(f, ID, `${BASE}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-api-key': opts.apiKey,
        'x-api-sign': hmacSha256Hex(opts.apiSecret, body),
      },
      body,
    });
    if (res.code !== 0) throw new ProviderError(ID, 'rejected', res.msg || `code ${res.code}`);
    return res.data;
  }

  async function currencies(): Promise<FfCcy[]> {
    if (ccyCache && Date.now() - ccyCache.at < 3600_000) return ccyCache.list;
    const list = await call<FfCcy[]>('ccies');
    ccyCache = { at: Date.now(), list };
    return list;
  }

  async function codeFor(asset: AssetRef): Promise<string> {
    const hit = (await currencies()).find(
      (c) => c.coin.toUpperCase() === asset.coin && toCanonical(NETWORK_ALIASES.fixedfloat, c.network) === asset.network,
    );
    if (!hit) throw new ProviderError(ID, 'unsupported', `${asset.coin}/${asset.network} not supported`);
    return hit.code;
  }

  return {
    id: ID,
    name: 'FixedFloat',
    trackingUrl: () => null,

    async listAssets() {
      const out: ProviderAsset[] = [];
      for (const c of await currencies()) {
        const network = toCanonical(NETWORK_ALIASES.fixedfloat, c.network);
        if (!network) continue;
        out.push({
          coin: c.coin.toUpperCase(),
          network,
          name: c.name,
          hasMemo: !!c.tag,
          canDeposit: !!c.send,
          canSettle: !!c.recv,
        });
      }
      return out;
    },

    async quote({ from, to, settleAmount }) {
      const [fromCcy, toCcy] = await Promise.all([codeFor(from), codeFor(to)]);
      const p = await call<FfPrice>('price', { type: 'fixed', fromCcy, toCcy, direction: 'to', amount: settleAmount });
      if (p.errors?.length) throw new ProviderError(ID, 'unsupported', p.errors.join(', '));
      return {
        provider: ID,
        from,
        to,
        depositAmount: p.from.amount,
        settleAmount: p.to.amount,
        rate: fmt(new Decimal(p.to.amount).div(p.from.amount).toDecimalPlaces(12)),
        // FixedFloat locks the rate when the order is created, not at price time.
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        context: { fromCcy, toCcy },
      };
    },

    async createSwap({ quote, settleAddress, settleMemo }) {
      const o = await call<FfOrder>('create', {
        type: 'fixed',
        fromCcy: quote.context.fromCcy,
        toCcy: quote.context.toCcy,
        direction: 'to',
        amount: quote.settleAmount,
        toAddress: settleAddress,
        ...(settleMemo ? { tag: settleMemo } : {}),
        ...(opts.refcode ? { refcode: opts.refcode } : {}),
        ...(opts.afftax != null ? { afftax: opts.afftax } : {}),
      });
      return {
        providerOrderId: o.id,
        providerToken: o.token,
        depositAddress: o.from.address ?? '',
        depositMemo: o.from.tag ?? null,
        depositAmount: o.from.amount,
        settleAmount: o.to.amount,
        expiresAt: new Date(o.time.expiration * 1000).toISOString(),
        providerStatus: o.status,
        raw: o,
      };
    },

    async getSwap({ providerOrderId, providerToken }): Promise<SwapState> {
      const o = await call<FfOrder>('order', { id: providerOrderId, token: providerToken });
      const status = STATUS[o.status] ?? 'EXCHANGING';
      return {
        status,
        providerStatus: o.status,
        depositTxHash: o.from.tx?.id ?? null,
        settleTxHash: o.to.tx?.id ?? null,
        settledAmount: status === 'SETTLED' ? (o.to.tx?.amount ?? o.to.amount) : null,
        raw: o,
      };
    },
  };
}
