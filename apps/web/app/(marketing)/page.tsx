import Link from 'next/link';

const STEPS = [
  { n: '1', title: 'Create a payment', body: 'POST the amount and your order id. We return a hosted checkout link.' },
  { n: '2', title: 'Customer picks a coin', body: 'BTC, ETH, SOL, USDT on Tron… whatever they hold, on the network they prefer.' },
  { n: '3', title: 'We find the cheapest route', body: 'Live quotes from several exchange providers are compared on every payment.' },
  { n: '4', title: 'You get paid', body: 'Funds land in your own wallet in the coin you chose, and a signed webhook fires.' },
];

const FEATURES = [
  { title: 'Non-custodial', body: 'Swaps pay out directly to your wallet. ZodyPay never holds your funds or keys.' },
  { title: 'Best-rate routing', body: 'Fixed-rate quotes from multiple providers, ranked by what your customer actually pays.' },
  { title: 'Exact settlement', body: 'Invoices are priced so you receive the exact amount — fees are included up front.' },
  { title: 'Signed webhooks', body: 'HMAC-SHA256 signatures, automatic retries with backoff, and one-click resend.' },
  { title: 'Idempotent API', body: 'Safe retries with Idempotency-Key. Amounts are decimal strings — never floats.' },
  { title: 'Test mode', body: 'Simulated providers walk through the full lifecycle so you can integrate for free.' },
];

const SNIPPET = `curl https://api.zodypay.com/v1/payments \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"49.99","currency":"USD","order_id":"1042"}'

# → { "id": "pay_...", "status": "pending",
#     "checkout_url": "https://pay.zodypay.com/p/pay_..." }`;

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-96 max-w-4xl rounded-full bg-brand/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <span className="inline-flex rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
              One API · 100+ coins · Your wallet
            </span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
              Accept any crypto.
              <br />
              <span className="text-brand">Settle in the coin you want.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              ZodyPay lets any app, store or service take crypto payments with one REST call. Customers pay with what
              they hold; we route the swap through the cheapest provider and deliver straight to your wallet.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="rounded-lg bg-brand px-5 py-3 text-sm font-medium text-white hover:bg-brand-strong">
                Start in test mode
              </Link>
              <Link href="/docs" className="rounded-lg border border-border bg-surface px-5 py-3 text-sm font-medium hover:bg-surface-2">
                Read the docs
              </Link>
            </div>
          </div>
          <pre className="overflow-x-auto rounded-2xl border border-border bg-surface p-5 font-mono text-[13px] leading-6 shadow-xl shadow-brand/5">
            {SNIPPET}
          </pre>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-surface p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{s.n}</span>
              <p className="mt-4 font-medium">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Built for real payments</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-surface p-5">
              <p className="font-medium">{f.title}</p>
              <p className="mt-1 text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 pt-8">
        <div className="flex flex-col items-start gap-6 rounded-3xl bg-brand px-8 py-10 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-2xl font-semibold">Integrate in an afternoon.</p>
            <p className="mt-1 text-white/80">Test mode is free and needs no exchange accounts.</p>
          </div>
          <Link href="/register" className="rounded-lg bg-white px-5 py-3 text-sm font-medium text-brand hover:bg-white/90">
            Create an account
          </Link>
        </div>
      </section>
    </>
  );
}
