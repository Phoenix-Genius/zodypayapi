import type { SwapStatus } from '../db/schema.js';

export interface AssetRef {
  /** Uppercase ticker, e.g. "USDT". */
  coin: string;
  /** Canonical lowercase network id, e.g. "tron" (see networks.ts). */
  network: string;
}

export interface ProviderAsset extends AssetRef {
  name: string;
  hasMemo: boolean;
  canDeposit: boolean;
  canSettle: boolean;
}

export interface Quote {
  provider: string;
  from: AssetRef;
  to: AssetRef;
  /** What the customer must send. Includes all provider and payout network fees. */
  depositAmount: string;
  /** What the merchant receives. */
  settleAmount: string;
  rate: string;
  expiresAt: string;
  /** Provider-specific context needed to create the swap from this quote. */
  context: Record<string, string | null>;
}

export interface CreateSwapInput {
  quote: Quote;
  settleAddress: string;
  settleMemo: string | null;
  refundAddress: string | null;
  userIp: string;
  /** Our swap id, passed to providers that accept an external reference. */
  externalId: string;
}

export interface SwapOrder {
  providerOrderId: string;
  providerToken: string | null;
  depositAddress: string;
  depositMemo: string | null;
  depositAmount: string;
  settleAmount: string;
  expiresAt: string;
  providerStatus: string;
  raw: unknown;
}

export interface SwapState {
  status: SwapStatus;
  providerStatus: string;
  depositTxHash: string | null;
  settleTxHash: string | null;
  /** Amount actually delivered to the merchant, when known. */
  settledAmount: string | null;
  raw: unknown;
}

export interface SwapProvider {
  id: string;
  name: string;
  /** Link a customer can use to follow the order on the provider's site. */
  trackingUrl(providerOrderId: string): string | null;
  listAssets(): Promise<ProviderAsset[]>;
  /** Fixed-rate quote for an exact settle amount. */
  quote(req: { from: AssetRef; to: AssetRef; settleAmount: string; userIp: string }): Promise<Quote>;
  createSwap(input: CreateSwapInput): Promise<SwapOrder>;
  getSwap(ref: { providerOrderId: string; providerToken: string | null }): Promise<SwapState>;
}

/**
 * `unsupported`: the pair/amount isn't offered (expected, not a health problem).
 * `unavailable`: network error, timeout or 5xx (counts against provider health).
 * `rejected`: provider refused the request (bad address, limits, region).
 */
export type ProviderErrorKind = 'unsupported' | 'unavailable' | 'rejected';

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}
