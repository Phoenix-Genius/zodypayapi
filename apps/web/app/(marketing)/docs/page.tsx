import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Documentation' };

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOC = [
  ['quickstart', 'Quickstart'],
  ['auth', 'Authentication'],
  ['create', 'Create a payment'],
  ['statuses', 'Payment statuses'],
  ['webhooks', 'Webhooks'],
  ['verify', 'Verifying signatures'],
  ['idempotency', 'Idempotency'],
  ['errors', 'Errors'],
  ['testing', 'Test mode'],
] as const;

const CREATE = `curl ${API}/v1/payments \\
  -H "Authorization: Bearer sk_test_..." \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "49.99",
    "currency": "USD",
    "order_id": "1042",
    "description": "2x T-shirt",
    "success_url": "https://shop.example/thanks",
    "metadata": { "customer_id": "c_881" }
  }'`;

const RESPONSE = `{
  "id": "pay_Xk2v9sW1...",
  "object": "payment",
  "livemode": false,
  "status": "pending",
  "order_id": "1042",
  "amount": "49.99",
  "currency": "USD",
  "settlement": {
    "coin": "USDC", "network": "base",
    "address": "0x…", "memo": null,
    "expected_amount": "49.99", "received_amount": null,
    "tx_hash": null, "tx_url": null
  },
  "swap": null,
  "checkout_url": "https://pay.example.com/p/pay_Xk2v9sW1...",
  "metadata": { "customer_id": "c_881" },
  "expires_at": "2026-10-26T13:00:00.000Z",
  "paid_at": null,
  "created_at": "2026-10-26T12:00:00.000Z"
}`;

const WEBHOOK = `POST /your/webhook
Content-Type: application/json
ZodyPay-Signature: t=1761480000,v1=5f2b…c9

{
  "id": "evt_9sd8f7…",
  "type": "payment.paid",
  "created_at": "2026-10-26T12:04:11.000Z",
  "data": { "object": { /* payment, same shape as the API */ } }
}`;

const VERIFY_NODE = `import crypto from 'node:crypto';
import express from 'express';

function verify(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const given = String(parts.v1 ?? '');
  return given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const app = express();
// Use the raw body: re-serialising parsed JSON changes the bytes and breaks the signature.
app.post('/webhooks/zodypay', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verify(raw, req.get('ZodyPay-Signature') ?? '', process.env.ZODYPAY_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }
  const event = JSON.parse(raw);
  // Deduplicate on event.id — deliveries can repeat.
  if (event.type === 'payment.paid') markOrderPaid(event.data.object.order_id);
  res.sendStatus(200);
});`;

const VERIFY_PY = `import hmac, hashlib, time

def verify(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts.get("t", 0))
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))`;

export default function Docs() {
  return (
    <div className="mx-auto flex max-w-6xl gap-12 px-4 py-16">
      <aside className="sticky top-24 hidden h-fit w-48 shrink-0 lg:block">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">On this page</p>
        <nav className="space-y-1.5 text-sm">
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block text-muted hover:text-text">
              {label}
            </a>
          ))}
          <a href="/api/docs" className="block pt-3 font-medium text-brand">
            API reference →
          </a>
        </nav>
      </aside>

      <article className="prose-docs min-w-0 flex-1">
        <h1 className="text-4xl font-semibold tracking-tight">Developer documentation</h1>
        <p className="mt-3 text-lg">
          Accept crypto with one API call and a webhook. The full machine-readable spec is at{' '}
          <a className="text-brand underline" href="/api/docs">/docs (OpenAPI)</a>.
        </p>

        <h2 id="quickstart">Quickstart</h2>
        <ul>
          <li>Create an account and an <strong>app</strong> in the dashboard. Set the coin, network and wallet address you want to be paid in.</li>
          <li>Create a <strong>test</strong> API key on the app&apos;s API keys tab.</li>
          <li>Create a payment from your server and redirect the customer to <code>checkout_url</code>.</li>
          <li>Set a webhook URL and mark the order paid when you receive <code>payment.paid</code>.</li>
          <li>Switch to a <strong>live</strong> key when you are ready.</li>
        </ul>

        <h2 id="auth">Authentication</h2>
        <p>
          Send your secret key as a bearer token: <code>Authorization: Bearer sk_live_…</code>. Keys starting with{' '}
          <code>sk_test_</code> create test-mode payments that use simulated providers. Keys are only shown once; keep
          them on your server and never in browser or mobile code.
        </p>

        <h2 id="create">Create a payment</h2>
        <pre>{CREATE}</pre>
        <table>
          <thead>
            <tr><th>Field</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code>amount</code></td><td>Decimal <em>string</em>, e.g. <code>&quot;49.99&quot;</code>. Numbers are rejected to avoid float rounding.</td></tr>
            <tr><td><code>currency</code></td><td>Fiat (<code>USD</code>, <code>EUR</code>, <code>GBP</code>, …) or a coin ticker.</td></tr>
            <tr><td><code>order_id</code></td><td>Your reference; returned in every webhook.</td></tr>
            <tr><td><code>success_url</code>, <code>cancel_url</code></td><td>Optional redirects from the checkout page.</td></tr>
            <tr><td><code>metadata</code></td><td>Up to 20 string key/value pairs.</td></tr>
            <tr><td><code>expires_in_minutes</code></td><td>15–1440, default 60.</td></tr>
          </tbody>
        </table>
        <p>Response (HTTP 201):</p>
        <pre>{RESPONSE}</pre>
        <p>
          <code>settlement.expected_amount</code> is what you will receive in your settlement coin. Stablecoins pegged to
          the invoice currency convert 1:1; other coins are priced from a market feed when the payment is created.
        </p>

        <h2 id="statuses">Payment statuses</h2>
        <table>
          <tbody>
            <tr><td><code>pending</code></td><td>Waiting for the customer to choose a coin and send funds.</td></tr>
            <tr><td><code>processing</code></td><td>Deposit detected; the swap is confirming or exchanging.</td></tr>
            <tr><td><code>paid</code></td><td>Funds delivered to your wallet (within your underpayment tolerance). <strong>Fulfil the order.</strong></td></tr>
            <tr><td><code>underpaid</code></td><td>Delivered, but less than expected. Check <code>settlement.received_amount</code>.</td></tr>
            <tr><td><code>expired</code></td><td>No payment before <code>expires_at</code>. A late deposit can still move it to <code>paid</code>.</td></tr>
            <tr><td><code>refunded</code> / <code>failed</code></td><td>The provider refunded the customer or the swap failed.</td></tr>
            <tr><td><code>canceled</code></td><td>Canceled through the API before the customer paid.</td></tr>
          </tbody>
        </table>

        <h2 id="webhooks">Webhooks</h2>
        <p>
          Events: <code>payment.processing</code>, <code>payment.paid</code>, <code>payment.underpaid</code>,{' '}
          <code>payment.expired</code>, <code>payment.refunded</code>, <code>payment.failed</code>,{' '}
          <code>payment.canceled</code>. Respond with any 2xx within 10 seconds. Failed deliveries are retried 10 times
          over about two days (30s, 2m, 10m, 30m, 1h, 2h, 4h, 8h, 12h, 24h) and can be resent from the dashboard.
        </p>
        <pre>{WEBHOOK}</pre>

        <h2 id="verify">Verifying signatures</h2>
        <p>
          The <code>ZodyPay-Signature</code> header contains a timestamp and an HMAC-SHA256 of{' '}
          <code>{'{timestamp}.{raw body}'}</code> keyed with your app&apos;s webhook secret (dashboard → Webhooks).
          Reject old timestamps to prevent replays.
        </p>
        <h3>Node.js</h3>
        <pre>{VERIFY_NODE}</pre>
        <h3>Python</h3>
        <pre>{VERIFY_PY}</pre>

        <h2 id="idempotency">Idempotency</h2>
        <p>
          Send <code>Idempotency-Key</code> on <code>POST /v1/payments</code> (your order id works well). Retrying with
          the same key and body returns the original payment with header <code>Idempotent-Replayed: true</code>. Reusing
          a key with a different body returns <code>409</code>. Keys are kept for 7 days.
        </p>

        <h2 id="errors">Errors</h2>
        <pre>{`{ "error": { "code": "invalid_request", "message": "Request validation failed", "details": [...] } }`}</pre>
        <table>
          <tbody>
            <tr><td><code>400</code></td><td>Invalid parameters.</td></tr>
            <tr><td><code>401</code></td><td>Missing or invalid API key.</td></tr>
            <tr><td><code>404</code></td><td>Not found (or belongs to another app/mode).</td></tr>
            <tr><td><code>409</code></td><td>Conflict, e.g. canceling a paid payment or reusing an idempotency key.</td></tr>
            <tr><td><code>429</code></td><td>Rate limited; back off and retry.</td></tr>
          </tbody>
        </table>

        <h2 id="testing">Test mode</h2>
        <p>
          Test keys route through two simulated providers (<em>MockSwap</em> and <em>MockDEX</em>) with fixed prices.
          After a swap is created it advances automatically: awaiting deposit → confirming → exchanging → settled.
          Enter <code>MOCK-UNDERPAY</code> as the refund address at checkout to simulate a 10% underpayment.
        </p>
      </article>
    </div>
  );
}
