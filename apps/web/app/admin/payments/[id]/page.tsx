'use client';

import { useParams } from 'next/navigation';
import { PaymentDetailView } from '@/components/payment-detail';

export default function AdminPaymentPage() {
  const { id } = useParams<{ id: string }>();
  return <PaymentDetailView path={`/admin/payments/${id}`} backHref="/admin/payments" admin />;
}
