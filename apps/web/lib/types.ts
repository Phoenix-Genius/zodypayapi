export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'underpaid' | 'expired' | 'failed' | 'refunded' | 'canceled';

export interface Swap {
  id: string;
  provider: string;
  provider_name: string;
  status: string;
  deposit_coin: string;
  deposit_network: string;
  deposit_address: string;
  deposit_memo: string | null;
  deposit_amount: string;
  settle_amount: string;
  settled_amount: string | null;
  rate: string;
  quote_expires_at: string;
  deposit_tx_hash: string | null;
  deposit_tx_url: string | null;
  settle_tx_hash: string | null;
  tracking_url: string | null;
  created_at: string;
  provider_order_id?: string;
  provider_status?: string;
}

export interface Payment {
  id: string;
  livemode: boolean;
  status: PaymentStatus;
  order_id: string;
  amount: string;
  currency: string;
  description: string | null;
  settlement: {
    coin: string;
    network: string;
    address: string;
    memo: string | null;
    expected_amount: string;
    received_amount: string | null;
    tx_hash: string | null;
    tx_url: string | null;
  };
  swap: Swap | null;
  checkout_url: string;
  metadata: Record<string, string>;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
  app_id?: string;
}

export interface Delivery {
  id: string;
  event_id: string;
  url: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

export interface PaymentDetail {
  payment: Payment;
  swaps: Swap[];
  events: { id: string; type: string; created_at: string }[];
  deliveries: Delivery[];
}

export interface AppInfo {
  id: string;
  name: string;
  webhook_url: string | null;
  settle_coin: string;
  settle_network: string;
  settle_address: string;
  settle_memo: string | null;
  underpay_tolerance_bps: number;
  created_at: string;
}

export interface Stats {
  total: number;
  paid: number;
  conversion: number;
  by_status: Record<string, number>;
  volume: { currency: string; amount: string }[];
  settled: { coin: string; network: string; amount: string }[];
  daily: { day: string; created: number; paid: number }[];
}

export interface Asset {
  coin: string;
  network: string;
  name: string;
  network_name: string;
  has_memo?: boolean;
}

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'merchant';
}
