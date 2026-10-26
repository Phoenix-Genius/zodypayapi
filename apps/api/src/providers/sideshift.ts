import { requestJson, type FetchFn } from './http.js';
import { NETWORK_ALIASES, fromCanonical, toCanonical } from './networks.js';
import { ProviderError, type ProviderAsset, type SwapProvider, type SwapState } from './types.js';
import type { SwapStatus } from '../db/schema.js';
import { Decimal, fmt } from '../lib/money.js';

// Docs: https://docs.sideshift.ai — fixed quote for settleAmount, then /shifts/fixed.
const BASE = 'https://sideshift.ai/api/v2';
const ID = 'sideshift';

type NetList = string[] | boolean;
interface SsCoin {
  coin: string;
  name: string;
  networks: string[];
  networksWithMemo?: string[];
  depositVariableOnly?: NetList;
  settleVariableOnly?: NetList;
  depositOffline?: NetList;
  settleOffline?: NetList;
}
interface SsQuote {
  id: string;
  depositAmount: string;
  settleAmount: string;
  rate: string;
  expiresAt: string;
}
interface SsShift {
  id: string;
  status: string;
  depositAddress: string;
  depositMemo?: string;
  depositAmount?: string;
  settleAmount?: string;
  expiresAt: string;
  depositHash?: string;
  settleHash?: string;
  deposits?: { status: string; depositHash?: string; settleHash?: string; settleAmount?: string }[];
}

const STATUS: Record<string, SwapStatus> = {
  waiting: 'AWAITING_DEPOSIT',
  pending: 'CONFIRMING',
  processing: 'EXCHANGING',
  settling: 'EXCHANGING',
  review: 'ON_HOLD',
  settled: 'SETTLED',
  refund: 'REFUNDING',
  refunding: 'REFUNDING',
  refunded: 'REFUNDED',
  expired: 'EXPIRED',
};

const hasNet = (list: NetList | undefined, net: string) => list === true || (Array.isArray(list) && list.includes(net));

export function createSideShiftProvider(opts: { secret: string; affiliateId: string; fetch?: FetchFn }): SwapProvider {
  const f = opts.fetch ?? fetch;
  const aliases = NETWORK_ALIASES.sideshift;
  const headers = (userIp?: string) => ({
    'content-type': 'application/json',
    'x-sideshift-secret': opts.secret,
    ...(userIp ? { 'x-user-ip': userIp } : {}),
  });
  const net = (canonical: string) => {
    const n = fromCanonical(aliases, canonical);
    if (!n) throw new ProviderError(ID, 'unsupported', `Network ${canonical} not supported`);
    return n;
  };

  return {
    id: ID,
    name: 'SideShift.ai',
    trackingUrl: (id) => `https://sideshift.ai/orders/${id}`,

    async listAssets() {
      const coins = await requestJson<SsCoin[]>(f, ID, `${BASE}/coins`, { headers: headers() });
      const out: ProviderAsset[] = [];
      for (const c of coins) {
        for (const n of c.networks) {
          const network = toCanonical(aliases, n);
          if (!network) continue;
          out.push({
            coin: c.coin.toUpperCase(),
            network,
            name: c.name,
            hasMemo: c.networksWithMemo?.includes(n) ?? false,
            // We only use fixed-rate shifts, so variable-only networks are excluded.
            canDeposit: !hasNet(c.depositOffline, n) && !hasNet(c.depositVariableOnly, n),
            canSettle: !hasNet(c.settleOffline, n) && !hasNet(c.settleVariableOnly, n),
          });
        }
      }
      return out;
    },

    async quote({ from, to, settleAmount, userIp }) {
      const q = await requestJson<SsQuote>(f, ID, `${BASE}/quotes`, {
        method: 'POST',
        headers: headers(userIp),
        body: JSON.stringify({
          depositCoin: from.coin,
          depositNetwork: net(from.network),
          settleCoin: to.coin,
          settleNetwork: net(to.network),
          depositAmount: null,
          settleAmount,
          affiliateId: opts.affiliateId,
        }),
      }).catch((err: ProviderError) => {
        // SideShift answers 400 for unsupported pairs and out-of-range amounts.
        throw err.kind === 'rejected' ? new ProviderError(ID, 'unsupported', err.message) : err;
      });
      return {
        provider: ID,
        from,
        to,
        depositAmount: q.depositAmount,
        settleAmount: q.settleAmount,
        rate: q.rate,
        expiresAt: q.expiresAt,
        context: { quoteId: q.id },
      };
    },

    async createSwap({ quote, settleAddress, settleMemo, refundAddress, userIp, externalId }) {
      const s = await requestJson<SsShift>(f, ID, `${BASE}/shifts/fixed`, {
        method: 'POST',
        headers: headers(userIp),
        body: JSON.stringify({
          quoteId: quote.context.quoteId,
          settleAddress,
          ...(settleMemo ? { settleMemo } : {}),
          ...(refundAddress ? { refundAddress } : {}),
          affiliateId: opts.affiliateId,
          externalId,
        }),
      });
      return {
        providerOrderId: s.id,
        providerToken: null,
        depositAddress: s.depositAddress,
        depositMemo: s.depositMemo ?? null,
        depositAmount: s.depositAmount ?? quote.depositAmount,
        settleAmount: s.settleAmount ?? quote.settleAmount,
        expiresAt: s.expiresAt,
        providerStatus: s.status,
        raw: s,
      };
    },

    async getSwap({ providerOrderId }): Promise<SwapState> {
      const s = await requestJson<SsShift>(f, ID, `${BASE}/shifts/${encodeURIComponent(providerOrderId)}`, {
        headers: headers(),
      });
      if (s.status === 'multiple') {
        // Several deposits were sent to the same address; report the aggregate.
        const settled = (s.deposits ?? []).filter((d) => d.status === 'settled');
        const total = settled.reduce((sum, d) => sum.plus(d.settleAmount ?? 0), new Decimal(0));
        return {
          status: settled.length ? 'SETTLED' : 'EXCHANGING',
          providerStatus: 'multiple',
          depositTxHash: s.deposits?.[0]?.depositHash ?? null,
          settleTxHash: settled[0]?.settleHash ?? null,
          settledAmount: settled.length ? fmt(total) : null,
          raw: s,
        };
      }
      return {
        status: STATUS[s.status] ?? 'EXCHANGING',
        providerStatus: s.status,
        depositTxHash: s.depositHash ?? null,
        settleTxHash: s.settleHash ?? null,
        settledAmount: s.status === 'settled' ? (s.settleAmount ?? null) : null,
        raw: s,
      };
    },
  };
}
