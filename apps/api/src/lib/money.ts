import { Decimal } from 'decimal.js';

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Positive decimal string with up to 18 fractional digits, e.g. "49.99". */
export const DECIMAL_RE = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;

export function dec(v: Decimal.Value): Decimal {
  return new Decimal(v);
}

/** Canonical string form for storage/API output (no exponent, trailing zeros trimmed). */
export function fmt(v: Decimal.Value): string {
  const d = new Decimal(v);
  return d.toFixed();
}

/** Minimum amount the merchant must receive for the payment to count as fully paid. */
export function minAcceptable(expected: Decimal.Value, tolBps: number): Decimal {
  return new Decimal(expected).mul(new Decimal(10_000 - tolBps).div(10_000));
}
