'use client';

import { useParams } from 'next/navigation';
import { PaymentDetailView } from '@/components/payment-detail';

export default function DashboardPaymentPage() {
  const { appId, paymentId } = useParams<{ appId: string; paymentId: string }>();
  return (
    <PaymentDetailView
      path={`/dashboard/apps/${appId}/payments/${paymentId}`}
      backHref={`/dashboard/apps/${appId}?tab=payments`}
      appId={appId}
    />
  );
}
