'use client';

import { useState } from 'react';
import { PaymentsTable } from '@/components/payments-table';
import { PageHeader, Select } from '@/components/ui';

export default function AdminPayments() {
  const [mode, setMode] = useState<'' | 'live' | 'test'>('');
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="All payments across every merchant."
        actions={
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-36">
            <option value="">All modes</option>
            <option value="live">Live</option>
            <option value="test">Test</option>
          </Select>
        }
      />
      <PaymentsTable basePath="/admin/payments" extraQuery={mode ? `&mode=${mode}` : ''} detailHref={(p) => `/admin/payments/${p.id}`} />
    </>
  );
}
