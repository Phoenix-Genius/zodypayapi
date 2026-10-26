import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'FAQ' };

const FAQ = [
  {
    q: 'Does ZodyPay hold my funds?',
    a: 'No. Each payment is a swap executed by a third-party exchange provider that pays out directly to the wallet address you configure. We never control private keys or balances.',
  },
  {
    q: 'Do my customers need to do KYC?',
    a: 'We do not ask customers for identity documents. Exchange providers run their own compliance checks and may, in rare cases, pause a swap for review or decline customers from restricted regions. The checkout shows a link to the provider when that happens.',
  },
  {
    q: 'What happens if a customer sends the wrong amount?',
    a: 'If less than the quoted amount arrives, the provider either converts what was received at a floating rate or refunds it. The payment is then marked "underpaid" or "refunded" and you receive a webhook. Providing a refund address at checkout speeds up refunds.',
  },
  {
    q: 'What if the quote expires before the customer pays?',
    a: 'Fixed-rate quotes are valid for about 10–15 minutes. If the customer pays late, the provider decides whether to complete or refund. The customer can request a fresh quote while the payment is still open.',
  },
  {
    q: 'Can I receive the same coin the customer pays with?',
    a: 'Not yet — every payment currently goes through a swap provider, which cannot convert a coin into itself on the same network. Direct same-asset payments are on the roadmap.',
  },
  {
    q: 'How do I know a payment is really complete?',
    a: 'Listen for the payment.paid webhook, verify its signature, and then (optionally) re-fetch the payment from the API. The payment includes the payout transaction hash so you can check it on-chain.',
  },
  {
    q: 'Is there a sandbox?',
    a: 'Yes. Test-mode API keys use simulated providers that walk a payment through deposit, exchange and settlement in about a minute. No real funds move.',
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Frequently asked questions</h1>
      <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-surface">
        {FAQ.map((f) => (
          <details key={f.q} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {f.q}
              <span className="text-muted transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm leading-6 text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
