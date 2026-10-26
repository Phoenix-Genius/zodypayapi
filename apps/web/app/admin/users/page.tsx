'use client';

import { useState } from 'react';
import { useSession } from '@/components/app-shell';
import { Badge, Button, Card, Input, PageHeader, Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'merchant';
  disabled: boolean;
  app_count: number;
  created_at: string;
}
interface AdminApp {
  id: string;
  name: string;
  owner: string;
  settle: string;
  webhook_url: string | null;
  created_at: string;
}

export default function AdminUsers() {
  const { user: me } = useSession();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const users = useApi<{ data: AdminUser[] }>(`/admin/users${search ? `?q=${encodeURIComponent(search)}` : ''}`);
  const apps = useApi<{ data: AdminApp[] }>(`/admin/apps${search ? `?q=${encodeURIComponent(search)}` : ''}`);

  async function patch(id: string, body: object) {
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body });
      users.reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Users & apps" />
      <form
        className="mb-6 max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <Input placeholder="Search email, app name or id" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>

      <h2 className="mb-3 text-lg font-semibold">Users</h2>
      {!users.data ? (
        <Spinner />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Apps</th>
                  <th className="px-5 py-3 font-medium">Joined</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data.data.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-3">
                      {u.email} {u.disabled && <Badge tone="warning">disabled</Badge>}
                    </td>
                    <td className="px-5 py-3 capitalize">{u.role}</td>
                    <td className="px-5 py-3 tabular-nums">{u.app_count}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(u.created_at)}</td>
                    <td className="space-x-1 whitespace-nowrap px-5 py-3 text-right">
                      {u.id !== me.id && (
                        <>
                          <Button variant="ghost" className="!h-8" onClick={() => patch(u.id, { role: u.role === 'admin' ? 'merchant' : 'admin' })}>
                            {u.role === 'admin' ? 'Make merchant' : 'Make admin'}
                          </Button>
                          <Button variant="ghost" className={u.disabled ? '!h-8' : '!h-8 text-danger'} onClick={() => patch(u.id, { disabled: !u.disabled })}>
                            {u.disabled ? 'Enable' : 'Disable'}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <h2 className="mb-3 mt-10 text-lg font-semibold">Apps</h2>
      {!apps.data ? (
        <Spinner />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">App</th>
                  <th className="px-5 py-3 font-medium">Owner</th>
                  <th className="px-5 py-3 font-medium">Settlement</th>
                  <th className="px-5 py-3 font-medium">Webhook</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {apps.data.data.map((a) => (
                  <tr key={a.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{a.name}</p>
                      <p className="font-mono text-xs text-muted">{a.id}</p>
                    </td>
                    <td className="px-5 py-3 text-muted">{a.owner}</td>
                    <td className="px-5 py-3">{a.settle}</td>
                    <td className="max-w-[220px] truncate px-5 py-3 text-muted">{a.webhook_url ?? '—'}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
