'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CoinIcon, NetworkBadge } from '@/components/network-badge';
import { paymentUri, Qr } from '@/components/qr';
import { Alert, Button, CopyButton, Input, Spinner, cx } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { formatAmount, formatMoney, timeLeft } from '@/lib/format';
import type { Asset, Swap } from '@/lib/types';

interface CheckoutView {
  id: string;
  livemode: boolean;
  status: string;
  merchant_name: string;
  order_id: string;
  description: string | null;
  amount: string;
  currency: string;
  settlement: { coin: string; network: string; expected_amount: string };
  expires_at: string;
  success_url: string | null;
  cancel_url: string | null;
  swap: Swap | null;
}

interface QuoteOption {
  ref: string;
  provider: string;
  provider_name: string;
  deposit_coin: string;
  deposit_network: string;
  deposit_amount: string;
  settle_amount: string;
  rate: string;
  expires_at: string;
}

const FINAL_OK = ['paid', 'underpaid'];
const FINAL_BAD = ['expired', 'canceled', 'failed', 'refunded'];

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const view = useApi<CheckoutView>(`/checkout/${id}`, 5000);
  const [changing, setChanging] = useState(false);
  const now = useNow();

  const v = view.data;
  if (view.error && !v) {
    return (
      <Shell>
        <div className="p-8 text-center">
          <p className="font-medium">Payment not found</p>
          <p className="mt-1 text-sm text-muted">Check the link you were given.</p>
        </div>
      </Shell>
    );
  }
  if (!v) {
    return (
      <Shell>
        <div className="flex justify-center p-16 text-muted">
          <Spinner />
        </div>
      </Shell>
    );
  }

  const swap = v.swap;
  const swapPayable = swap?.status === 'awaiting_deposit' && new Date(swap.quote_expires_at).getTime() > now;
  let body: React.ReactNode;
  if (FINAL_OK.includes(v.status)) body = <Success view={v} />;
  else if (FINAL_BAD.includes(v.status) && !(swap && ['confirming', 'exchanging', 'on_hold'].includes(swap.status))) body = <Closed view={v} />;
  else if (v.status === 'processing' || (swap && ['confirming', 'exchanging', 'on_hold', 'refunding'].includes(swap.status))) body = <Progress view={v} swap={swap!} />;
  else if (swapPayable && !changing) body = <PayStep view={v} swap={swap!} now={now} onChange={() => setChanging(true)} />;
  else
    body = (
      <SelectStep
        view={v}
        now={now}
        expiredQuote={!!swap && swap.status === 'awaiting_deposit' && !swapPayable}
        onCreated={() => {
          setChanging(false);
          view.reload();
        }}
      />
    );

  return (
    <Shell livemode={v.livemode}>
      <Summary view={v} />
      {body}
    </Shell>
  );
}

function Shell({ children, livemode = true }: { children: React.ReactNode; livemode?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-8 sm:py-14">
      <div className="w-full max-w-md">
        {!livemode && (
          <div className="mb-3 rounded-lg bg-warning-soft px-3 py-1.5 text-center text-xs font-medium text-warning">
            Test payment — no real funds will move
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xl shadow-black/5">{children}</div>
        <p className="mt-6 text-center text-xs text-muted">
          Secured by <span className="font-medium text-text">ZodyPay</span> · non-custodial
        </p>
      </div>
    </div>
  );
}

function Summary({ view }: { view: CheckoutView }) {
  return (
    <div className="border-b border-border bg-surface-2/60 px-6 py-5">
      <p className="text-sm text-muted">{view.merchant_name}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{formatMoney(view.amount, view.currency)}</p>
      <p className="mt-1 truncate text-sm text-muted">{view.description ?? `Order ${view.order_id}`}</p>
    </div>
  );
}

const POPULAR = ['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'LTC', 'TRX', 'BNB', 'XMR', 'DOGE'];

function SelectStep({ view, now, expiredQuote, onCreated }: { view: CheckoutView; now: number; expiredQuote: boolean; onCreated: () => void }) {
  const { data, error } = useApi<{ options: (Asset & { has_memo: boolean })[] }>(`/checkout/${view.id}/options`);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Asset | null>(null);
  const [quotes, setQuotes] = useState<{ quotes: QuoteOption[]; compared: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refund, setRefund] = useState('');
  const [showRefund, setShowRefund] = useState(false);

  const options = useMemo(() => {
    const term = q.trim().toLowerCase();
    return [...(data?.options ?? [])]
      .filter((o) => !term || `${o.coin} ${o.name} ${o.network_name}`.toLowerCase().includes(term))
      .sort((a, b) => (POPULAR.indexOf(a.coin) + 1 || 99) - (POPULAR.indexOf(b.coin) + 1 || 99) || a.coin.localeCompare(b.coin));
  }, [data, q]);

  async function pick(a: Asset) {
    setSelected(a);
    setQuotes(null);
    setErr(null);
    setLoading(true);
    try {
      setQuotes(await api(`/checkout/${view.id}/quotes`, { method: 'POST', body: { coin: a.coin, network: a.network } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function confirm(ref: string) {
    setCreating(true);
    setErr(null);
    try {
      await api(`/checkout/${view.id}/swaps`, { method: 'POST', body: { quote_ref: ref, refund_address: refund.trim() || null } });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
      setCreating(false);
      // A used or stale quote can't be retried; fetch fresh ones.
      if (selected) void pick(selected);
    }
  }

  const best = quotes?.quotes[0];
  const bestExpired = best && new Date(best.expires_at).getTime() <= now;

  if (selected) {
    return (
      <div className="space-y-5 p-6">
        <button onClick={() => setSelected(null)} className="text-sm text-muted hover:text-text">
          ← Choose another coin
        </button>
        <div>
          <p className="text-sm text-muted">Pay with</p>
          <p className="text-lg font-semibold">
            <span className="inline-flex items-center gap-1.5">
              {selected.coin} <NetworkBadge network={selected.network} />
            </span>{' '}
            <span className="font-normal text-muted">on {selected.network_name}</span>
          </p>
        </div>
        {loading && (
          <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-4 text-sm text-muted">
            <Spinner className="h-4 w-4" /> Comparing exchange rates…
          </div>
        )}
        {err && <Alert>{err}</Alert>}
        {quotes && !best && <Alert tone="warning">No route is available for {selected.coin} right now. Please try another coin.</Alert>}
        {best && (
          <>
            <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted">You send</span>
                <span className="text-right text-xl font-semibold tabular-nums">
                  {formatAmount(best.deposit_amount)} {best.deposit_coin}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted">Merchant receives</span>
                <span className="tabular-nums">
                  {formatAmount(best.settle_amount, 6)} {view.settlement.coin}
                </span>
              </div>
              <p className="mt-3 text-xs text-muted">
                Best rate of {quotes.compared} provider{quotes.compared === 1 ? '' : 's'} · via {best.provider_name} · exchange and payout fees included
                {!bestExpired && ` · locked for ${timeLeft(best.expires_at, now)}`}
              </p>
            </div>
            {quotes.quotes.length > 1 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Compare {quotes.quotes.length} quotes</summary>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {quotes.quotes.map((qt, i) => (
                    <li key={qt.ref} className="flex justify-between px-3 py-2">
                      <span>
                        {qt.provider_name} {i === 0 && <span className="text-xs text-success">best</span>}
                      </span>
                      <span className="tabular-nums">{formatAmount(qt.deposit_amount)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {showRefund ? (
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Refund address ({selected.coin} on {selected.network_name})</span>
                <Input spellCheck={false} className="font-mono" value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="Your wallet address" />
                <span className="block text-xs text-muted">Used only if the exchange has to return your funds.</span>
              </label>
            ) : (
              <button onClick={() => setShowRefund(true)} className="text-sm text-brand">
                + Add a refund address (recommended)
              </button>
            )}
            {bestExpired ? (
              <Button className="w-full" onClick={() => pick(selected)}>
                Refresh rate
              </Button>
            ) : (
              <Button className="h-12 w-full text-base" loading={creating} onClick={() => confirm(best.ref)}>
                Continue to payment
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      {expiredQuote && (
        <div className="mb-4">
          <Alert tone="warning">Your previous quote expired. If you already sent funds, keep this page open — we&apos;ll update it automatically.</Alert>
        </div>
      )}
      <p className="mb-3 font-medium">Choose how to pay</p>
      <Input placeholder="Search coins or networks" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-[360px] space-y-1 overflow-y-auto">
        {!data && !error && (
          <div className="flex justify-center p-8 text-muted">
            <Spinner />
          </div>
        )}
        {error && <Alert>{error.message}</Alert>}
        {data && data.options.length === 0 && (
          <p className="p-6 text-center text-sm text-muted">
            No payment methods are available for this merchant right now. Please try again later.
          </p>
        )}
        {data && data.options.length > 0 && options.length === 0 && <p className="p-6 text-center text-sm text-muted">No coins match.</p>}
        {options.map((o) => (
          <button
            key={`${o.coin}:${o.network}`}
            onClick={() => pick(o)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2"
          >
            <CoinIcon coin={o.coin} network={o.network} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium">
                {o.coin} <NetworkBadge network={o.network} title={o.network_name} />
              </span>
              <span className="block truncate text-xs text-muted">
                {o.name} · {o.network_name}
              </span>
            </span>
          </button>
        ))}
      </div>
      {view.cancel_url && (
        <a href={view.cancel_url} className="mt-4 block text-center text-sm text-muted hover:text-text">
          Cancel and return to {view.merchant_name}
        </a>
      )}
    </div>
  );
}

function PayStep({ view, swap, now, onChange }: { view: CheckoutView; swap: Swap; now: number; onChange: () => void }) {
  const uri = paymentUri(swap.deposit_network, swap.deposit_coin, swap.deposit_address, swap.deposit_amount);
  const remaining = new Date(swap.quote_expires_at).getTime() - now;
  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-medium">
          Send {swap.deposit_coin} <NetworkBadge network={swap.deposit_network} />
        </p>
        <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums', remaining < 120_000 ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted')}>
          {timeLeft(swap.quote_expires_at, now)}
        </span>
      </div>

      <div className="flex justify-center">
        <Qr value={uri} />
      </div>

      <div className="space-y-3">
        <CopyRow label="Amount" value={swap.deposit_amount} display={`${formatAmount(swap.deposit_amount)} ${swap.deposit_coin}`} />
        <CopyRow label="Address" value={swap.deposit_address} mono />
        {swap.deposit_memo && (
          <>
            <CopyRow label="Memo / tag" value={swap.deposit_memo} mono />
            <Alert tone="warning">Include the memo exactly, or your payment cannot be credited.</Alert>
          </>
        )}
      </div>

      <p className="text-xs leading-5 text-muted">
        Send the exact amount in a single transaction from a wallet you control. Your wallet&apos;s network fee is
        extra. This page updates automatically.
      </p>

      <Timeline status={swap.status} />

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          Exchange by{' '}
          {swap.tracking_url ? (
            <a href={swap.tracking_url} target="_blank" rel="noreferrer" className="text-brand">
              {swap.provider_name}
            </a>
          ) : (
            swap.provider_name
          )}
        </span>
        <button onClick={onChange} className="hover:text-text">
          Change coin
        </button>
      </div>
    </div>
  );
}

function CopyRow({ label, value, display, mono }: { label: string; value: string; display?: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-1 flex items-center gap-3">
        <p className={cx('min-w-0 flex-1 break-all', mono ? 'font-mono text-sm' : 'text-lg font-semibold tabular-nums')}>{display ?? value}</p>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

const STEPS = [
  { key: 'awaiting_deposit', label: 'Waiting for your payment' },
  { key: 'confirming', label: 'Confirming on the blockchain' },
  { key: 'exchanging', label: 'Exchanging' },
  { key: 'settled', label: 'Paid' },
];

function Timeline({ status }: { status: string }) {
  const idx = Math.max(0, STEPS.findIndex((s) => s.key === (status === 'on_hold' ? 'exchanging' : status)));
  return (
    <ol className="space-y-2.5">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-3 text-sm">
          <span
            className={cx(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
              i < idx ? 'bg-success text-white' : i === idx ? 'bg-brand text-white' : 'bg-surface-2 text-muted',
            )}
          >
            {i < idx ? '✓' : i === idx ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> : ''}
          </span>
          <span className={i <= idx ? 'text-text' : 'text-muted'}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Progress({ view, swap }: { view: CheckoutView; swap: Swap }) {
  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-3">
        <Spinner className="h-5 w-5 text-brand" />
        <p className="font-medium">Payment received — processing</p>
      </div>
      <p className="text-sm text-muted">
        We detected your {swap.deposit_coin} deposit. The exchange is completing; this usually takes a few minutes. You can
        safely close this page.
      </p>
      {swap.status === 'on_hold' && (
        <Alert tone="warning">
          The exchange provider is reviewing this transaction.{' '}
          {swap.tracking_url ? (
            <a className="underline" href={swap.tracking_url} target="_blank" rel="noreferrer">
              Follow it on {swap.provider_name}
            </a>
          ) : (
            `Contact ${swap.provider_name} support with order ${swap.id}.`
          )}
        </Alert>
      )}
      {swap.status === 'refunding' && <Alert tone="warning">The provider is refunding this deposit.</Alert>}
      <Timeline status={swap.status} />
      {swap.deposit_tx_url && (
        <a href={swap.deposit_tx_url} target="_blank" rel="noreferrer" className="block text-sm text-brand">
          View your transaction ↗
        </a>
      )}
      <p className="text-xs text-muted">Order {view.order_id}</p>
    </div>
  );
}

function Success({ view }: { view: CheckoutView }) {
  const [left, setLeft] = useState(6);
  useEffect(() => {
    if (!view.success_url) return;
    const t = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [view.success_url]);
  useEffect(() => {
    if (view.success_url && left <= 0) window.location.href = view.success_url;
  }, [left, view.success_url]);

  return (
    <div className="p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-2xl text-success">✓</div>
      <p className="mt-4 text-lg font-semibold">{view.status === 'paid' ? 'Payment complete' : 'Payment received'}</p>
      <p className="mt-1 text-sm text-muted">
        {view.status === 'paid'
          ? `${view.merchant_name} has received your payment.`
          : `The amount received was lower than expected. ${view.merchant_name} will be in touch.`}
      </p>
      {view.swap?.deposit_tx_url && (
        <a href={view.swap.deposit_tx_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-brand">
          View transaction ↗
        </a>
      )}
      {view.success_url && (
        <a
          href={view.success_url}
          className="mt-6 flex h-10 w-full items-center justify-center rounded-lg bg-brand text-sm font-medium text-white hover:bg-brand-strong"
        >
          Return to {view.merchant_name}
          {left > 0 ? ` (${left})` : ''}
        </a>
      )}
    </div>
  );
}

function Closed({ view }: { view: CheckoutView }) {
  const msg: Record<string, string> = {
    expired: 'This payment link has expired.',
    canceled: 'This payment was canceled by the merchant.',
    failed: 'This payment could not be completed.',
    refunded: 'This payment was refunded.',
  };
  return (
    <div className="p-8 text-center">
      <p className="text-lg font-semibold">{msg[view.status] ?? 'This payment is closed.'}</p>
      <p className="mt-1 text-sm text-muted">If you already sent funds, contact {view.merchant_name} with order {view.order_id}.</p>
      {view.cancel_url && (
        <a href={view.cancel_url} className="mt-6 inline-block text-sm text-brand">
          Return to {view.merchant_name}
        </a>
      )}
    </div>
  );
}
