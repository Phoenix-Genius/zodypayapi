import Link from 'next/link';
import { Logo } from '@/components/logo';

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/coins', label: 'Coins' },
  { href: '/docs', label: 'Docs' },
  { href: '/faq', label: 'FAQ' },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-text">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-text">
              Log in
            </Link>
            <Link href="/register" className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-strong">
              Get started
            </Link>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-1 text-sm text-muted hover:text-text">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-4">
          <div className="space-y-2">
            <Logo />
            <p className="text-muted">Non-custodial crypto payments for apps and businesses.</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Product</p>
            <Link className="block text-muted hover:text-text" href="/features">Features</Link>
            <Link className="block text-muted hover:text-text" href="/pricing">Pricing</Link>
            <Link className="block text-muted hover:text-text" href="/coins">Supported coins</Link>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Developers</p>
            <Link className="block text-muted hover:text-text" href="/docs">Documentation</Link>
            <a className="block text-muted hover:text-text" href="/api/docs">API reference</a>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Company</p>
            <Link className="block text-muted hover:text-text" href="/faq">FAQ</Link>
          </div>
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted">
          © {new Date().getFullYear()} ZodyPay. Exchanges are executed by third-party providers under their own terms.
        </p>
      </footer>
    </div>
  );
}
