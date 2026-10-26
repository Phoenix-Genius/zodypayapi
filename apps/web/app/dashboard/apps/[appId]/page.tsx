'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useSession } from '@/components/app-shell';
import { DeliveriesTable } from '@/components/deliveries-table';
import { PaymentsTable } from '@/components/payments-table';
import { SettlementFields, type SettlementValue } from '@/components/settlement-fields';
import { StatsPanel } from '@/components/stats';
import { Alert, Button, Card, CopyButton, Empty, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { AppInfo, Delivery, Payment, Stats } from '@/lib/types';

type Tab = 'overview' | 'payments' | 'keys' | 'webhooks' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'payments', label: 'Payments' },
  { id: 'keys', label: 'API keys' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'settings', label: 'Settings' },
];

export default function AppPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AppDetail />
    </Suspense>
  );
}

function AppDetail() {
  const { appId } = useParams<{ appId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as Tab;
  const app = useApi<AppInfo>(`/dashboard/apps/${appId}`);

  if (app.error) return <Empty title="App not found">{app.error.message}</Empty>;
  if (!app.data) return <Spinner />;

  return (
    <>
      <PageHeader title={app.data.name} subtitle={<span className="font-mono text-xs">{app.data.id}</span>} />
      <Tabs tabs={TABS} value={tab} onChange={(t) => router.replace(`/dashboard/apps/${appId}?tab=${t}`)} />
      {tab === 'overview' && <OverviewTab app={app.data} />}
      {tab === 'payments' && <PaymentsTab app={app.data} />}
      {tab === 'keys' && <KeysTab app={app.data} />}
      {tab === 'webhooks' && <WebhooksTab app={app.data} onSaved={app.reload} />}
      {tab === 'settings' && <SettingsTab app={app.data} onSaved={app.reload} />}
    </>
  );
}

function OverviewTab({ app }: { app: AppInfo }) {
  const { mode } = useSession();
  const { data } = useApi<Stats>(`/dashboard/apps/${app.id}/stats?mode=${mode}`);
  return (
    <div className="space-y-6">
      {data ? <StatsPanel stats={data} /> : <Spinner />}
      <Card>
        <p className="font-medium">Integration checklist</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted">
          <li>Create an API key on the <strong>API keys</strong> tab.</li>
          <li>From your server, <code className="font-mono">POST /v1/payments</code> and redirect the customer to <code className="font-mono">checkout_url</code>.</li>
          <li>Add a webhook URL and verify the <code className="font-mono">ZodyPay-Signature</code> header.</li>
          <li>Fulfil orders on <code className="font-mono">payment.paid</code>.</li>
        </ol>
        <p className="mt-4 text-sm text-muted">
          Payouts go to <span className="font-mono text-text">{app.settle_address}</span> in {app.settle_coin} on {app.settle_network}.
        </p>
      </Card>
    </div>
  );
}

function PaymentsTab({ app }: { app: AppInfo }) {
  const { mode } = useSession();
  const [amount, setAmount] = useState('10.00');
  const [currency, setCurrency] = useState('USD');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Payment | null>(null);
  const [refresh, setRefresh] = useState(0);

  async function createTest() {
    setCreating(true);
    setError(null);
    try {
      // Show the link rather than auto-opening: popups opened after an await get blocked.
      setCreated(await api<Payment>(`/dashboard/apps/${app.id}/test-payments`, { method: 'POST', body: { amount, currency } }));
      setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      {mode === 'test' && (
        <Card>
          <p className="font-medium">Try the checkout</p>
          <p className="mt-1 text-sm text-muted">Creates a test payment with its own checkout link. Each payment gets a unique URL.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="sm:max-w-[140px]" inputMode="decimal" />
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="sm:max-w-[120px]">
              {['USD', 'EUR', 'GBP'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Button onClick={createTest} loading={creating}>
              Create test payment
            </Button>
          </div>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          {created && (
            <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
              <p className="text-xs text-muted">Checkout link for {created.id}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <a href={created.checkout_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-sm text-brand hover:underline">
                  {created.checkout_url}
                </a>
                <CopyButton value={created.checkout_url} />
                <a href={created.checkout_url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-text">
                  Open ↗
                </a>
              </div>
            </div>
          )}
        </Card>
      )}
      <PaymentsTable key={refresh} basePath={`/dashboard/apps/${app.id}/payments?mode=${mode}`} detailHref={(p) => `/dashboard/apps/${app.id}/payments/${p.id}`} />
    </div>
  );
}

interface KeyRow {
  id: string;
  mode: 'live' | 'test';
  prefix: string;
  last_used_at: string | null;
  created_at: string;
}

function KeysTab({ app }: { app: AppInfo }) {
  const keys = useApi<{ data: KeyRow[] }>(`/dashboard/apps/${app.id}/keys`);
  const [created, setCreated] = useState<{ key: string; mode: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(mode: 'live' | 'test') {
    setBusy(mode);
    setError(null);
    try {
      const res = await api<{ key: string; mode: string }>(`/dashboard/apps/${app.id}/keys`, { method: 'POST', body: { mode } });
      setCreated(res);
      await keys.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this key? Requests using it will fail immediately.')) return;
    await api(`/dashboard/apps/${app.id}/keys/${id}`, { method: 'DELETE' });
    await keys.reload();
  }

  return (
    <div className="space-y-6">
      {created && (
        <Alert tone="success">
          <p className="font-medium">New {created.mode} key — copy it now, it won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 font-mono text-xs text-text">{created.key}</code>
            <CopyButton value={created.key} />
          </div>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => create('test')} loading={busy === 'test'} variant="secondary">
          Create test key
        </Button>
        <Button onClick={() => create('live')} loading={busy === 'live'}>
          Create live key
        </Button>
      </div>
      {keys.data && keys.data.data.length === 0 && <Empty title="No API keys yet" />}
      {keys.data && keys.data.data.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Key</th>
                  <th className="px-5 py-3 font-medium">Mode</th>
                  <th className="px-5 py-3 font-medium">Last used</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {keys.data.data.map((k) => (
                  <tr key={k.id}>
                    <td className="px-5 py-3 font-mono text-xs">{k.prefix}…</td>
                    <td className="px-5 py-3 capitalize">{k.mode}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(k.last_used_at)}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(k.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" className="!h-8 text-danger" onClick={() => revoke(k.id)}>
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function WebhooksTab({ app, onSaved }: { app: AppInfo; onSaved: () => void }) {
  const [url, setUrl] = useState(app.webhook_url ?? '');
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const deliveries = useApi<{ data: Delivery[] }>(`/dashboard/apps/${app.id}/deliveries`, 15_000);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run('save', async () => {
              await api(`/dashboard/apps/${app.id}`, { method: 'PATCH', body: { webhook_url: url || null } });
              setMsg({ tone: 'success', text: 'Webhook URL saved' });
              onSaved();
            });
          }}
        >
          <Field label="Endpoint URL" hint="Events: payment.processing, paid, underpaid, expired, refunded, failed, canceled.">
            <Input type="url" placeholder="https://example.com/webhooks/zodypay" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy === 'save'}>
              Save
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'test'}
              disabled={!app.webhook_url}
              onClick={() =>
                run('test', async () => {
                  const r = await api<{ ok: boolean; statusCode: number | null; error: string | null }>(`/dashboard/apps/${app.id}/webhook-test`, {
                    method: 'POST',
                  });
                  setMsg(r.ok ? { tone: 'success', text: `Endpoint responded ${r.statusCode}` } : { tone: 'danger', text: `Test failed: ${r.error}` });
                })
              }
            >
              Send test event
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <p className="font-medium">Signing secret</p>
        <p className="mt-1 text-sm text-muted">Use it to verify the ZodyPay-Signature header. Rotating it invalidates the old secret immediately.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {secret ? (
            <>
              <code className="min-w-0 break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs">{secret}</code>
              <CopyButton value={secret} />
            </>
          ) : (
            <Button variant="secondary" loading={busy === 'reveal'} onClick={() => run('reveal', async () => setSecret((await api<{ secret: string }>(`/dashboard/apps/${app.id}/webhook-secret`)).secret))}>
              Reveal secret
            </Button>
          )}
          <Button
            variant="ghost"
            loading={busy === 'rotate'}
            onClick={() => {
              if (!confirm('Rotate the signing secret? Your endpoint must be updated with the new secret.')) return;
              void run('rotate', async () => setSecret((await api<{ secret: string }>(`/dashboard/apps/${app.id}/webhook-secret/rotate`, { method: 'POST' })).secret));
            }}
          >
            Rotate
          </Button>
        </div>
      </Card>

      <div>
        <h3 className="mb-3 font-medium">Recent deliveries</h3>
        {deliveries.data && deliveries.data.data.length === 0 && <Empty title="No deliveries yet" />}
        {deliveries.data && deliveries.data.data.length > 0 && <DeliveriesTable appId={app.id} rows={deliveries.data.data} onResent={deliveries.reload} />}
      </div>
    </div>
  );
}

function SettingsTab({ app, onSaved }: { app: AppInfo; onSaved: () => void }) {
  const [name, setName] = useState(app.name);
  const [tolerance, setTolerance] = useState(String(app.underpay_tolerance_bps));
  const [settle, setSettle] = useState<SettlementValue>({
    settle_coin: app.settle_coin,
    settle_network: app.settle_network,
    settle_address: app.settle_address,
    settle_memo: app.settle_memo ?? '',
  });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setName(app.name), [app.name]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api(`/dashboard/apps/${app.id}`, {
        method: 'PATCH',
        body: { name, underpay_tolerance_bps: Number(tolerance), ...settle, settle_memo: settle.settle_memo || null },
      });
      setMsg({ tone: 'success', text: 'Settings saved. New payments use the updated settlement; existing ones are unchanged.' });
      onSaved();
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <form onSubmit={save} className="space-y-5">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <SettlementFields value={settle} onChange={setSettle} />
        <Field label="Underpayment tolerance (basis points)" hint="Payments within this margin count as fully paid. 50 = 0.5%. Max 500.">
          <Input type="number" min={0} max={500} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
        </Field>
        <Button type="submit" loading={saving}>
          Save settings
        </Button>
      </form>
    </Card>
  );
}
