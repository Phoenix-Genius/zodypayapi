import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Pricing' };

export default function Pricing() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Simple pricing</h1>
      <p className="mt-3 text-lg text-muted">No monthly fees. No platform fee during beta.</p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border-2 border-brand bg-surface p-6">
          <p className="text-sm font-medium text-brand">Merchants</p>
          <p className="mt-2 text-5xl font-semibold">0%</p>
          <p className="mt-1 text-sm text-muted">platform fee</p>
          <ul className="mt-6 space-y-2 text-sm text-muted">
            <li>Unlimited apps, payments and API keys</li>
            <li>Free test mode</li>
            <li>Signed webhooks with retries</li>
            <li>Settle to your own wallet in your chosen coin</li>
          </ul>
          <Link href="/register" className="mt-6 inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-strong">
            Get started
          </Link>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm font-medium text-muted">Customers</p>
          <p className="mt-2 text-5xl font-semibold">Best rate</p>
          <p className="mt-1 text-sm text-muted">from competing providers</p>
          <p className="mt-6 text-sm text-muted">
            The amount shown at checkout already includes the exchange provider&apos;s fee and the payout network fee.
            We request fixed-rate quotes from every available provider and show the lowest. The only extra cost is
            the customer&apos;s own wallet network fee for sending the deposit.
          </p>
        </div>
      </div>

      <div className="mt-12 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        <p className="font-medium text-text">How do we make money?</p>
        <p className="mt-2">
          Exchange providers pay integrators a share of their own margin (for example, SideShift shares 0.5% at no
          extra cost to the customer). Because we always route to the cheapest quote for the customer, a provider
          can&apos;t win the route by paying us more.
        </p>
      </div>
    </div>
  );
}
