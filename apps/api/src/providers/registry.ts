import type { Config } from '../config.js';
import type { Mode } from '../db/schema.js';
import { createChangeNowProvider } from './changenow.js';
import { createFixedFloatProvider } from './fixedfloat.js';
import type { FetchFn } from './http.js';
import { createMockProvider } from './mock.js';
import { createSideShiftProvider } from './sideshift.js';
import type { SwapProvider } from './types.js';

export interface ProviderRegistry {
  forMode(mode: Mode): SwapProvider[];
  get(id: string): SwapProvider | undefined;
  all(): SwapProvider[];
}

/** Live providers are enabled by the presence of their credentials; test mode uses mocks only. */
export function createProviderRegistry(config: Config, fetchFn: FetchFn = fetch): ProviderRegistry {
  const live: SwapProvider[] = [];
  if (config.SIDESHIFT_SECRET && config.SIDESHIFT_AFFILIATE_ID) {
    live.push(
      createSideShiftProvider({
        secret: config.SIDESHIFT_SECRET,
        affiliateId: config.SIDESHIFT_AFFILIATE_ID,
        fetch: fetchFn,
      }),
    );
  }
  if (config.CHANGENOW_API_KEY) {
    live.push(createChangeNowProvider({ apiKey: config.CHANGENOW_API_KEY, fetch: fetchFn }));
  }
  if (config.FIXEDFLOAT_API_KEY && config.FIXEDFLOAT_API_SECRET) {
    live.push(
      createFixedFloatProvider({
        apiKey: config.FIXEDFLOAT_API_KEY,
        apiSecret: config.FIXEDFLOAT_API_SECRET,
        refcode: config.FIXEDFLOAT_REFCODE,
        afftax: config.FIXEDFLOAT_AFFTAX,
        fetch: fetchFn,
      }),
    );
  }
  const test: SwapProvider[] = [
    createMockProvider({ id: 'mock-swap', name: 'MockSwap', feeBps: 80, stageSeconds: config.MOCK_STAGE_SECONDS }),
    createMockProvider({
      id: 'mock-dex',
      name: 'MockDEX',
      feeBps: 50,
      stageSeconds: config.MOCK_STAGE_SECONDS,
      excludeCoins: ['LTC'],
    }),
  ];
  const byId = new Map([...live, ...test].map((p) => [p.id, p]));
  return {
    forMode: (mode) => (mode === 'LIVE' ? live : test),
    get: (id) => byId.get(id),
    all: () => [...live, ...test],
  };
}
