import { AppShell } from '@/components/app-shell';

const NAV = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/users', label: 'Users & apps' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav={NAV} requireAdmin>
      {children}
    </AppShell>
  );
}
