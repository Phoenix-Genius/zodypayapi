'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** QR code rendered client-side; always dark-on-white so wallets can scan it in dark mode too. */
export function Qr({ value, size = 200 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return (
    <div className="rounded-xl bg-white p-2" style={{ width: size + 16, height: size + 16 }}>
      {src && <img src={src} width={size} height={size} alt="Payment QR code" />}
    </div>
  );
}

const URI_SCHEMES: Record<string, string> = { bitcoin: 'bitcoin', litecoin: 'litecoin', dogecoin: 'dogecoin', bitcoincash: 'bitcoincash' };

/** BIP21-style URI where wallets support it reliably; otherwise just the address. */
export function paymentUri(network: string, coin: string, address: string, amount: string): string {
  const scheme = URI_SCHEMES[network];
  const native = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE', bitcoincash: 'BCH' }[network];
  if (scheme && native === coin) {
    const addr = address.startsWith(`${scheme}:`) ? address.slice(scheme.length + 1) : address;
    return `${scheme}:${addr}?amount=${amount}`;
  }
  return address;
}
