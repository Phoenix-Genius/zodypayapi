import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function isPrivateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('::ffff:')) return isPrivateV4(v.slice(7));
  return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') ||
    v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

export function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip);
}

/** Syntactic check used when a merchant saves a webhook URL. */
export function validateWebhookUrl(raw: string, { allowPrivate, requireHttps }: { allowPrivate: boolean; requireHttps: boolean }) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Webhook URL is not a valid URL';
  }
  if (url.protocol !== 'https:' && (requireHttps || url.protocol !== 'http:')) {
    return requireHttps ? 'Webhook URL must use https' : 'Webhook URL must use http or https';
  }
  if (url.username || url.password) return 'Webhook URL must not contain credentials';
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
      return 'Webhook URL must be publicly reachable';
    }
    if (isIP(host) && isPrivateAddress(host)) return 'Webhook URL must be publicly reachable';
  }
  return null;
}

/** Resolves the host right before sending and refuses private targets. */
export async function assertPublicHost(raw: string): Promise<void> {
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error(`Refusing to deliver to private address ${address}`);
  }
}
