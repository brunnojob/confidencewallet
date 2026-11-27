import { randomUUID } from 'node:crypto';
import { configured, db, mp, origin, respond } from '../lib/gateway.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { error: 'Método inválido' });
  if (req.headers.origin !== origin) return respond(res, 403, { error: 'Origem recusada' });
  if (!configured()) return respond(res, 503, { error: 'Checkout de teste aguardando configuração segura.' });
  const { productId, idempotencyKey } = req.body || {};
  if (!uuid.test(productId || '') || !uuid.test(idempotencyKey || '')) return respond(res, 400, { error: 'Produto ou chave inválida' });
  try {
    const [product] = await db(`/products?id=eq.${productId}&active=eq.true&select=id,title,price_cents,seller_id`);
    if (!product) return respond(res, 404, { error: 'Produto indisponível' });
    // A single Mercado Pago test seller exists. Other sellers require their own OAuth connection.
    if (product.seller_id !== process.env.MP_TEST_SELLER_ID) return respond(res, 409, { error: 'Vendedor ainda não conectado ao Mercado Pago.' });
    const orderId = randomUUID();
    await db('/checkout_orders', { method: 'POST', body: JSON.stringify({
      id: orderId, product_id: product.id, seller_id: product.seller_id,
      amount_cents: product.price_cents, idempotency_key: idempotencyKey
    }) });
    const amount = (product.price_cents / 100).toFixed(2);
    const back = `${origin}/checkout.html?order=${orderId}`;
    const checkout = await mp('/v1/orders', { method: 'POST',
      headers: { 'X-Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ type: 'online', processing_mode: 'manual', capture_mode: 'automatic_async',
        total_amount: amount, external_reference: orderId,
        items: [{ title: product.title, quantity: 1, unit_price: amount }],
        config: { online: { success_url: back, pending_url: back, failure_url: back, auto_return: 'all' } }
      }) });
    if (typeof checkout.id !== 'string' || typeof checkout.checkout_url !== 'string') throw Error('Invalid MP order');
    const checkoutUrl = new URL(checkout.checkout_url);
    if (!/^(.+\.)?mercadopago\.com\.br$/.test(checkoutUrl.hostname) || checkoutUrl.protocol !== 'https:') throw Error('Invalid checkout URL');
    const saved = await db(`/checkout_orders?id=eq.${orderId}&mp_order_id=is.null`, { method: 'PATCH',
      body: JSON.stringify({ mp_order_id: checkout.id, checkout_url: checkoutUrl.href }) });
    if (saved.length !== 1) throw Error('Order association failed');
    return respond(res, 201, { orderId, checkoutUrl: checkoutUrl.href });
  } catch (error) {
    console.error('test order creation:', error.message);
    return respond(res, 503, { error: 'Não foi possível iniciar a cobrança de teste.' });
  }
}
