import { randomUUID } from 'node:crypto';
import { configured, db, mp, origin, respond } from '../lib/gateway.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { error: 'Método inválido' });
  if (req.headers.origin !== origin) return respond(res, 403, { error: 'Origem recusada' });
  if (!configured()) return respond(res, 503, { error: 'Checkout aguardando configuração segura do Mercado Pago.' });
  const { productId, idempotencyKey } = req.body || {};
  if (!uuid.test(productId || '') || !uuid.test(idempotencyKey || '')) return respond(res, 400, { error: 'Produto ou chave inválida' });
  try {
    const [product] = await db(`/products?id=eq.${productId}&active=eq.true&select=id,title,price_cents,seller_id`);
    if (!product) return respond(res, 404, { error: 'Produto indisponível' });
    const orderId = randomUUID();
    await db('/checkout_orders', { method: 'POST', body: JSON.stringify({
      id: orderId, product_id: product.id, seller_id: product.seller_id,
      amount_cents: product.price_cents, idempotency_key: idempotencyKey
    }) });
    const checkout = await mp('/checkout/preferences', { method: 'POST',
      headers: { 'X-Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ external_reference: orderId,
        items: [{ id: product.id, title: product.title, quantity: 1, currency_id: 'BRL', unit_price: product.price_cents / 100 }],
        back_urls: Object.fromEntries(['success', 'pending', 'failure'].map(s => [s, `${origin}/checkout.html?order=${orderId}`]))
      }) });
    if (typeof checkout.id !== 'string' || !checkout.id) throw Error('Invalid preference ID');
    const checkoutUrl = new URL(checkout.init_point);
    if (!/^(.+\.)?mercadopago\.com\.br$/.test(checkoutUrl.hostname) || checkoutUrl.protocol !== 'https:') throw Error('Invalid checkout URL');
    const saved = await db(`/checkout_orders?id=eq.${orderId}&mp_preference_id=is.null`, { method: 'PATCH',
      body: JSON.stringify({ mp_preference_id: String(checkout.id), checkout_url: checkoutUrl.href }) });
    if (saved.length !== 1) throw Error('Preference association failed');
    return respond(res, 201, { orderId, checkoutUrl: checkoutUrl.href });
  } catch (error) {
    console.error('checkout creation:', error.message);
    return respond(res, 503, { error: 'Não foi possível iniciar a cobrança. Tente novamente.' });
  }
}
