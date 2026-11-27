import { createHmac, timingSafeEqual } from 'node:crypto';

export const origin = 'https://confidencewallet.vercel.app';
const dbUrl = 'https://wabpybyaqiatelaecpal.supabase.co/rest/v1';
export function configured() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.MP_TEST_ACCESS_TOKEN &&
    process.env.MP_TEST_WEBHOOK_SECRET && process.env.MP_TEST_SELLER_ID);
}
export function respond(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(code).json(body);
}
export async function db(path, options = {}) {
  const response = await fetch(dbUrl + path, {
    ...options,
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Database ${response.status}: ${JSON.stringify(data).slice(0,300)}`);
  return data;
}
export async function mp(path, options = {}) {
  const response = await fetch('https://api.mercadopago.com' + path, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.MP_TEST_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mercado Pago ${response.status}`);
  return data;
}
export function validSignature(signature, requestId, dataId, secret, now = Date.now()) {
  if (typeof signature !== 'string' || typeof requestId !== 'string' || !/^ORD[A-Z0-9]{10,64}$/i.test(String(dataId))) return false;
  const parts = Object.fromEntries(signature.split(',').map(x => x.trim().split('=', 2)));
  if (!/^\d{10,13}$/.test(parts.ts || '') || !/^[a-f0-9]{64}$/i.test(parts.v1 || '')) return false;
  const timestamp = Number(parts.ts) * (parts.ts.length === 10 ? 1000 : 1);
  if (Math.abs(now - timestamp) > 10 * 60_000) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}
export function centsFromDecimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value);
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(n) ? n : null;
}
