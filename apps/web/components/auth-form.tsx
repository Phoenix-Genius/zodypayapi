'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api<{ user: User }>(`/auth/${mode}`, { method: 'POST', body: { email, password } });
      const next = params.get('next');
      // Only allow same-site relative redirects ("//x" and "/\x" are protocol-relative).
      router.push(next && /^\/(?![/\\])/.test(next) ? next : '/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <h1 className="text-xl font-semibold">{mode === 'login' ? 'Log in' : 'Create your account'}</h1>
          <p className="mt-1 text-sm text-muted">
            {mode === 'login' ? 'Welcome back.' : 'Start in test mode — no exchange accounts needed.'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {error && <Alert>{error}</Alert>}
            <Field label="Email">
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" hint={mode === 'register' ? 'At least 10 characters.' : undefined}>
              <Input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 10 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" loading={loading} className="w-full">
              {mode === 'login' ? 'Log in' : 'Create account'}
            </Button>
          </form>
        </Card>
        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'login' ? (
            <>
              No account? <Link className="text-brand" href="/register">Sign up</Link>
            </>
          ) : (
            <>
              Already have an account? <Link className="text-brand" href="/login">Log in</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
