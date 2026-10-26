'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SettlementFields, type SettlementValue } from '@/components/settlement-fields';
import { Alert, Button, Card, Field, Input, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import type { AppInfo } from '@/lib/types';

export default function NewApp() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [webhook, setWebhook] = useState('');
  const [settle, setSettle] = useState<SettlementValue>({ settle_coin: 'USDC', settle_network: 'base', settle_address: '', settle_memo: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const app = await api<AppInfo>('/dashboard/apps', {
        method: 'POST',
        body: { name, webhook_url: webhook || null, ...settle, settle_memo: settle.settle_memo || null },
      });
      router.push(`/dashboard/apps/${app.id}?tab=keys`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="New app" subtitle="An app is one website, store or service that takes payments." />
      <Card>
        <form onSubmit={submit} className="space-y-5">
          {error && <Alert>{error}</Alert>}
          <Field label="Name" hint="Shown to customers on the checkout page.">
            <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <SettlementFields value={settle} onChange={setSettle} />
          <Field label="Webhook URL (optional)" hint="We POST signed payment events here. You can add it later.">
            <Input type="url" placeholder="https://example.com/webhooks/zodypay" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          </Field>
          <Button type="submit" loading={saving}>
            Create app
          </Button>
        </form>
      </Card>
    </div>
  );
}
