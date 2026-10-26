'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { Spinner, cx } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { User } from '@/lib/types';

type Mode = 'test' | 'live';
interface Session {
  user: User;
  mode: Mode;
  setMode: (m: Mode) => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside AppShell');
  return s;
}

function readMode(): Mode {
  try {
    return localStorage.getItem('zp_mode') === 'live' ? 'live' : 'test';
  } catch {
    return 'test';
  }
}

export function AppShell({
  nav,
  requireAdmin,
  children,
}: {
  nav: { href: string; label: string; exact?: boolean }[];
  requireAdmin?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [mode, setModeState] = useState<Mode>('test');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setModeState(readMode());
    api<{ user: User }>('/auth/me')
      .then(({ user }) => {
        if (requireAdmin && user.role !== 'admin') router.replace('/dashboard');
        else setUser(user);
      })
      .catch((e: ApiError) => {
        if (e.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });
  }, [router, pathname, requireAdmin]);

  useEffect(() => setMenuOpen(false), [pathname]);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem('zp_mode', m);
    } catch {
      // Storage unavailable; the toggle still works for this page view.
    }
  };

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  const isActive = (n: { href: string; exact?: boolean }) => (n.exact ? pathname === n.href : pathname.startsWith(n.href));

  const sidebar = (
    <>
      <div className="flex h-16 items-center px-5">
        <Logo href="/dashboard" />
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx(
              'block rounded-lg px-3 py-2 text-sm font-medium',
              isActive(n) ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            {n.label}
          </Link>
        ))}
        {user.role === 'admin' && !requireAdmin && (
          <Link href="/admin" className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
            Admin
          </Link>
        )}
        {requireAdmin && (
          <Link href="/dashboard" className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
            ← Merchant dashboard
          </Link>
        )}
      </nav>
      <div className="space-y-3 border-t border-border p-4">
        {!requireAdmin && (
          <div className="flex rounded-lg bg-surface-2 p-1 text-xs font-medium">
            {(['test', 'live'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cx(
                  'flex-1 rounded-md py-1.5 capitalize',
                  mode === m ? (m === 'test' ? 'bg-warning-soft text-warning' : 'bg-surface text-text shadow-sm') : 'text-muted',
                )}
              >
                {m} mode
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-muted">{user.email}</span>
          <button onClick={logout} className="shrink-0 text-muted hover:text-text">
            Log out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <SessionContext.Provider value={{ user, mode, setMode }}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">{sidebar}</aside>
        {menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside className="relative flex h-full w-64 flex-col bg-surface" onClick={(e) => e.stopPropagation()}>
              {sidebar}
            </aside>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <header className="flex h-14 items-center gap-3 border-b border-border bg-surface px-4 md:hidden">
            <button onClick={() => setMenuOpen(true)} className="rounded-md p-1.5 hover:bg-surface-2" aria-label="Open menu">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 5h14M3 10h14M3 15h14" />
              </svg>
            </button>
            <Logo href="/dashboard" />
          </header>
          {mode === 'test' && !requireAdmin && (
            <div className="border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">
              Test mode — simulated providers, no real funds move
            </div>
          )}
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</main>
        </div>
      </div>
    </SessionContext.Provider>
  );
}
