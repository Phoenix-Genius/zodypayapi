import { z } from 'zod';
import { NETWORKS } from '../providers/networks.js';
import { DECIMAL_RE } from './money.js';

export const decimalString = z
  .string()
  .regex(DECIMAL_RE, 'Must be a positive decimal string, e.g. "49.99"')
  .refine((v) => Number(v) > 0, 'Must be greater than zero');

export const coinCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,12}$/, 'Invalid coin ticker');

export const networkId = z
  .string()
  .trim()
  .toLowerCase()
  .refine((n) => n in NETWORKS, 'Unsupported network');

/** Loose on purpose: providers validate addresses per chain; we only block obvious garbage. */
export const cryptoAddress = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9:._-]{8,128}$/, 'Invalid address');

export const memo = z.string().trim().max(100).regex(/^[\x20-\x7E]*$/, 'Memo must be printable ASCII');

export const modeParam = z
  .enum(['live', 'test'])
  .default('test')
  .transform((m) => (m === 'live' ? 'LIVE' : 'TEST') as 'LIVE' | 'TEST');

export const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

export const idParam = (name: string) => z.object({ [name]: z.string().min(3).max(64) });
