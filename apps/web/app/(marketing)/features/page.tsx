import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Features' };

const SECTIONS = [
  {
    title: 'Hosted checkout',
    points: [
      'Mobile-first payment page with QR code, exact amount and copy buttons',
      'Customer chooses coin and network; memo/tag warnings where required',
      'Live status timeline from deposit to settlement',
      'Redirect back to your success URL when paid',
    ],
  },
  {
    title: 'Smart routing',
    points: [
      'Fixed-rate quotes from SideShift, ChangeNOW and FixedFloat',
      'Ranked by the amount the customer sends — fees already included',
      'Circuit breaker skips providers that are failing or slow',
      'Quotes never deliver less than the invoice requires',
    ],
  },
  {
    title: 'Merchant dashboard',
    points: [
      'Multiple apps per account, each with its own keys and webhook',
      'Live and test API keys, revocable at any time',
      'Payment history with swap details, transaction hashes and event log',
      'Webhook delivery log with one-click resend',
    ],
  },
  {
    title: 'Safety by design',
    points: [
      'Non-custodial: payouts go straight to your wallet address',
      'Settlement details are snapshotted per payment',
      'HMAC-signed webhooks with timestamps against replay',
      'API keys and session tokens stored only as hashes',
    ],
  },
];

export default function Features() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Features</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">Everything you need to take crypto payments without running nodes or holding funds.</p>
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <div key={s.title} className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <ul className="mt-4 space-y-2">
              {s.points.map((p) => (
                <li key={p} className="flex gap-2 text-sm text-muted">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
