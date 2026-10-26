/** Amounts arrive as decimal strings; format for display without converting through floats. */
export function formatAmount(value: string | null | undefined, maxDecimals = 8): string {
  if (value == null) return '—';
  const [int = '0', frac = ''] = value.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

const FIAT_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹' };

export function formatMoney(amount: string, currency: string): string {
  const sym = FIAT_SYMBOLS[currency];
  return sym ? `${sym}${formatAmount(amount, 2)}` : `${formatAmount(amount)} ${currency}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeLeft(iso: string, now = Date.now()): string {
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function shorten(value: string, head = 8, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
