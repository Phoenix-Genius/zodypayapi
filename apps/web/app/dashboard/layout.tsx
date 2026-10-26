import { AppShell } from '@/components/app-shell';

const NAV = [
  { href: '/dashboard', label: 'Overview', exact: true },
  { href: '/dashboard/apps', label: 'Apps' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV}>{children}</AppShell>;
}
