import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hmacSha256Hex } from '../src/lib/crypto.js';
import { createFixedFloatProvider } from '../src/providers/fixedfloat.js';
import { createSideShiftProvider } from '../src/providers/sideshift.js';
import { ProviderError } from '../src/providers/types.js';

type Call = { url: string; init: RequestInit };

function stubFetch(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    const { status = 200, body } = routes[key]!({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { f, calls };
}

describe('SideShift adapter', () => {
  it('requests an exact-settle fixed quote with affiliate id and user ip', async () => {
    const { f, calls } = stubFetch({
      '/quotes': () => ({
        status: 201,
        body: { id: 'q1', depositAmount: '0.0004', settleAmount: '25', rate: '62500', expiresAt: '2030-01-01T00:00:00Z' },
      }),
    });
    const p = createSideShiftProvider({ secret: 's3cret', affiliateId: 'aff', fetch: f });
    const q = await p.quote({
      from: { coin: 'BTC', network: 'bitcoin' },
      to: { coin: 'USDC', network: 'base' },
      settleAmount: '25',
      userIp: '203.0.113.9',
    });
    assert.equal(q.depositAmount, '0.0004');
    assert.equal(q.context.quoteId, 'q1');
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(body, {
      depositCoin: 'BTC',
      depositNetwork: 'bitcoin',
      settleCoin: 'USDC',
      settleNetwork: 'base',
      depositAmount: null,
      settleAmount: '25',
      affiliateId: 'aff',
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers['x-sideshift-secret'], 's3cret');
    assert.equal(headers['x-user-ip'], '203.0.113.9');
  });

  it('treats 4xx quote errors as unsupported routes, 5xx as unavailable', async () => {
    const bad = createSideShiftProvider({
      secret: 's',
      affiliateId: 'a',
      fetch: stubFetch({ '/quotes': () => ({ status: 400, body: { error: { message: 'Amount too low' } } }) }).f,
    });
    const req = { from: { coin: 'BTC', network: 'bitcoin' }, to: { coin: 'USDC', network: 'base' }, settleAmount: '1', userIp: '1.1.1.1' };
    await assert.rejects(bad.quote(req), (e: ProviderError) => e.kind === 'unsupported' && /too low/.test(e.message));
    const down = createSideShiftProvider({
      secret: 's',
      affiliateId: 'a',
      fetch: stubFetch({ '/quotes': () => ({ status: 503, body: {} }) }).f,
    });
    await assert.rejects(down.quote(req), (e: ProviderError) => e.kind === 'unavailable');
  });

  it('maps shift statuses including multiple deposits', async () => {
    let shift: unknown = { id: 'x', status: 'review' };
    const p = createSideShiftProvider({ secret: 's', affiliateId: 'a', fetch: stubFetch({ '/shifts/': () => ({ body: shift }) }).f });
    assert.equal((await p.getSwap({ providerOrderId: 'x', providerToken: null })).status, 'ON_HOLD');
    shift = { id: 'x', status: 'settled', settleAmount: '25', settleHash: '0xabc', depositHash: 'dd' };
    const settled = await p.getSwap({ providerOrderId: 'x', providerToken: null });
    assert.deepEqual([settled.status, settled.settledAmount, settled.settleTxHash], ['SETTLED', '25', '0xabc']);
    shift = {
      id: 'x',
      status: 'multiple',
      deposits: [
        { status: 'settled', settleAmount: '10.1', settleHash: 'h1' },
        { status: 'settled', settleAmount: '0.2' },
        { status: 'pending' },
      ],
    };
    const multi = await p.getSwap({ providerOrderId: 'x', providerToken: null });
    assert.equal(multi.settledAmount, '10.3', 'decimal sum, no float drift');
  });

  it('only lists fixed-rate capable networks it knows', async () => {
    const p = createSideShiftProvider({
      secret: 's',
      affiliateId: 'a',
      fetch: stubFetch({
        '/coins': () => ({
          body: [
            {
              coin: 'USDT',
              name: 'Tether',
              networks: ['tron', 'ethereum', 'somechain'],
              depositVariableOnly: ['ethereum'],
              settleVariableOnly: false,
              depositOffline: false,
              settleOffline: false,
              networksWithMemo: [],
            },
          ],
        }),
      }).f,
    });
    const assets = await p.listAssets();
    assert.equal(assets.length, 2, 'unknown network skipped');
    assert.equal(assets.find((a) => a.network === 'ethereum')!.canDeposit, false);
    assert.equal(assets.find((a) => a.network === 'tron')!.canDeposit, true);
  });
});

describe('FixedFloat adapter', () => {
  it('signs requests and resolves composite currency codes', async () => {
    const { f, calls } = stubFetch({
      '/ccies': () => ({
        body: {
          code: 0,
          msg: 'OK',
          data: [
            { code: 'BTC', coin: 'BTC', network: 'BTC', name: 'Bitcoin', recv: 1, send: 1, tag: null },
            { code: 'USDTTRC', coin: 'USDT', network: 'TRX', name: 'Tether', recv: 1, send: 1, tag: null },
          ],
        },
      }),
      '/price': () => ({
        body: { code: 0, msg: 'OK', data: { from: { code: 'BTC', amount: '0.0002' }, to: { code: 'USDTTRC', amount: '12' }, errors: [] } },
      }),
    });
    const p = createFixedFloatProvider({ apiKey: 'k', apiSecret: 'sec', fetch: f });
    const q = await p.quote({
      from: { coin: 'BTC', network: 'bitcoin' },
      to: { coin: 'USDT', network: 'tron' },
      settleAmount: '12',
      userIp: '1.1.1.1',
    });
    assert.equal(q.context.toCcy, 'USDTTRC');
    const priceCall = calls.find((c) => c.url.endsWith('/price'))!;
    const body = String(priceCall.init.body);
    assert.deepEqual(JSON.parse(body), { type: 'fixed', fromCcy: 'BTC', toCcy: 'USDTTRC', direction: 'to', amount: '12' });
    const headers = priceCall.init.headers as Record<string, string>;
    assert.equal(headers['x-api-sign'], hmacSha256Hex('sec', body));
  });
});
