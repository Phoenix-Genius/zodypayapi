# ZodyPay — universal crypto payment gateway

Merchants create a payment through a REST API and redirect the customer to a hosted checkout. The customer pays with any supported coin. The platform compares fixed-rate quotes from several exchange providers, routes the payment to the cheapest one, and the provider pays out **directly to the merchant's wallet** in the coin they chose. A signed webhook then confirms the payment.

The platform is non-custodial: it never holds funds or private keys.

```
apps/api   Fastify + TypeScript REST API, Drizzle + SQLite (libsql), optional Redis/BullMQ worker
apps/web   Next.js 16 + Tailwind: public site, docs, merchant dashboard, admin, hosted checkout
```

## Quick start

No external services needed. The data lives in a SQLite file and background jobs run inside the API process.

```bash
npm install
cp .env.example .env
# Set APP_ENCRYPTION_KEY in .env:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# For local webhook testing, also set ALLOW_PRIVATE_WEBHOOKS=true

npm run dev:api    # API on :4000, database at apps/api/data/zodypay.db (migrations run on start)
npm run dev:web    # web on :3000 (proxies /api → :4000)
```

1. Open http://localhost:3000/register. The **first account becomes the platform admin**.
2. Create an app, then on **Payments**, click **Create test payment** to walk through the checkout.
3. Test mode uses two simulated providers (MockSwap and MockDEX), so you can see the routing choose between them. A swap settles about 4 × `MOCK_STAGE_SECONDS` after it's created. Enter `MOCK-UNDERPAY` as the refund address to simulate an underpayment.

Create or promote an admin from the command line: `npm run seed:admin -w apps/api -- you@example.com 'long-password'`.

### Docker

```bash
cp .env.example .env    # set APP_ENCRYPTION_KEY (+ provider keys for live mode)
docker compose up --build
```

This runs the API and the web app, with the SQLite database on a named volume.

### Separate worker (optional)

Set `REDIS_URL` to move background jobs out of the API process into a BullMQ worker (`npm run dev:worker`, or `node dist/worker.js` in the API image). The cache also moves to Redis. SQLite runs in WAL mode with a busy timeout, so the API and the worker can share one database file on the same host. Running several API instances across machines needs a client/server database. The data layer is Drizzle, so moving back to Postgres means changing the schema dialect and a few raw queries.

## Tests

```bash
npm test          # 18 tests: full payment lifecycle on a temp SQLite DB + provider adapter contracts
npm run typecheck
```

## How a payment flows

1. `POST /v1/payments {amount:"49.99", currency:"USD", order_id}` creates a payment. The amount the merchant must receive in their settlement coin is computed and stored at this point: 1:1 for pegged stablecoins, CoinGecko price otherwise. Settlement address and network are snapshotted onto the payment.
2. The customer opens `/p/{id}` and picks a coin and network. `POST /checkout/{id}/quotes` asks every eligible provider in parallel for an **exact-output fixed-rate** quote, drops any quote that delivers less than required, and ranks the rest by deposit amount. Quote refs are single-use and stored server-side.
3. `POST /checkout/{id}/swaps` creates the provider order with the merchant's payout address. The customer sees the deposit address, QR code, memo and a countdown.
4. The worker polls active swaps, maps each provider's status to one normalized set, and updates the payment. The status change and its webhook are written in one transaction (outbox pattern).
5. The webhook is delivered with an `HMAC-SHA256` signature (`ZodyPay-Signature: t=…,v1=…`) and retried 10 times over about 2 days.

Payment statuses: `pending → processing → paid | underpaid`, plus `expired`, `canceled`, `refunded` and `failed`. If a deposit arrives after expiry or cancellation and settles, the payment still moves to `paid`, because the merchant really did receive the funds.

## Project layout

```
apps/api/src
  app.ts              Fastify setup, error handling, OpenAPI (/docs)
  server.ts           API entry point (runs jobs in-process when REDIS_URL is unset)
  worker.ts jobs.ts   Optional BullMQ worker and the shared job definitions
  auth.ts             Session cookies (+CSRF header), API-key auth
  db/schema.ts        Drizzle SQLite schema → drizzle/0000_init.sql
  providers/          SwapProvider interface, SideShift, ChangeNOW, FixedFloat, mocks, network aliases
  services/           payments (state machine), checkout, provider routing + circuit breaker, pricing, webhooks, stats
  routes/             v1 (merchant API), checkout (public), dashboard, admin, auth
apps/web
  app/(marketing)     Home, features, pricing, coins, FAQ, docs
  app/dashboard       Merchant dashboard (apps, keys, webhooks, payments, stats, settings)
  app/admin           Platform admin (providers, health, users, payments)
  app/p/[id]          Hosted checkout
```

## Coin & network icons

`apps/web/public/crypto/{coins,networks}/*.svg` are extracted from [web3icons](https://github.com/0xa3k5/web3icons) (MIT). See `public/crypto/NOTICE.txt`. Coins without a logo fall back to their ticker. To refresh them:

```bash
mkdir /tmp/w3i && cd /tmp/w3i && npm pack @web3icons/core && tar xzf web3icons-core-*.tgz
python3 -I apps/web/scripts/extract-icons.py /tmp/w3i/package/dist/svgs apps/web/public/crypto
```

The script parses the SVG strings without executing the package's code, and skips any SVG with scripts or event handlers.

## Going live

1. Create provider accounts and set their credentials in `.env`. A provider turns on when its credentials are present:
   - **SideShift**: `SIDESHIFT_SECRET` and `SIDESHIFT_AFFILIATE_ID`. Pays integrators 0.5% at no extra cost to the customer. Requires the real customer IP (`x-user-ip`) and doesn't allow proxying users. Restricted jurisdictions apply.
   - **ChangeNOW**: `CHANGENOW_API_KEY`. Set your partner fee in their dashboard.
   - **FixedFloat**: `FIXEDFLOAT_API_KEY` and `FIXEDFLOAT_API_SECRET`. Optional `FIXEDFLOAT_REFCODE` and `FIXEDFLOAT_AFFTAX`.
2. Run behind HTTPS with `COOKIE_SECURE=true` and `TRUST_PROXY=true`, so customer IPs passed to providers are the real ones. Set `WEB_URL` to the public checkout domain.
3. Make **small real payments** through each provider (for example $10–20) before onboarding merchants. There are no provider testnets.
4. Get legal advice on whether your jurisdiction treats this service as money transmission or a VASP.

## Known limitations

- **Provider adapters need live verification.** The SideShift adapter follows its official v2 docs (quotes with `settleAmount`, `/shifts/fixed`, status values). ChangeNOW (v2 fixed-rate *reverse* flow) and FixedFloat (v2 signed POST API) were written from their published v2 API shapes, because their official docs couldn't be fetched during development. Field names are kept inside each adapter file and the contracts are unit-tested, but confirm them against your partner docs before going live.
- **Settlement isn't independently verified on-chain yet.** The provider's status plus the payout tx hash are trusted. Adding an RPC or explorer check is the next hardening step.
- **Same-asset payments aren't supported.** For example, a customer paying USDC on Base to a merchant settling in USDC on Base. Swap providers can't do this, so the option is hidden at checkout. It needs xpub-derived deposit addresses.
- **THORChain and LI.FI aren't integrated.** They need a connect-wallet checkout, because of THORChain memos and LI.FI's customer-signed transactions.
- **SQLite means a single host.** Amounts are stored as exact decimal strings and summed with decimal.js, never in SQL. To scale out horizontally, move to Postgres.
- Rate limits are in-memory per API instance. There's no email verification or password reset yet.
- Webhook SSRF protection resolves DNS before each send, but isn't immune to DNS rebinding. For strict isolation, send webhooks through an egress proxy.
