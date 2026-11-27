import { configured, db, mp, respond, validSignature, centsFromDecimal } from '../lib/gateway.js';

export function confirmedOrder(order, expectedCents, providerId, reference) {
  return order?.id === providerId && order.external_reference === reference &&
    order.currency === 'BRL' && centsFromDecimal(order.total_amount) === expectedCents;
}
export function statusFromProvider(order, expectedCents) {
  if (order.status === 'processed' && order.status_detail === 'accredited' &&
      centsFromDecimal(order.total_paid_amount) === expectedCents) return 'approved';
  if (order.status === 'canceled') return 'cancelled';
  if (order.status === 'failed') return 'rejected';
  return 'pending';
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { error: 'Método inválido' });
  if (!configured()) return respond(res, 503, { error: 'Webhook de teste não configurado' });
  const id = req.query['data.id'];
  if (req.query.type !== 'order' || typeof id !== 'string' || !/^ORD[A-Z0-9]{10,64}$/i.test(id) ||
      (req.body?.data?.id && String(req.body.data.id) !== id) || req.body?.live_mode !== false)
    return respond(res, 400, { error: 'Notificação de teste inválida' });
  if (!validSignature(req.headers['x-signature'], req.headers['x-request-id'], id, process.env.MP_TEST_WEBHOOK_SECRET))
    return respond(res, 401, { error: 'Assinatura inválida' });
  try {
    const providerOrder = await mp(`/v1/orders/${encodeURIComponent(id)}`);
    if (providerOrder.id !== id || typeof providerOrder.external_reference !== 'string')
      return respond(res, 422, { error: 'Order inesperada' });
    const [local] = await db(`/checkout_orders?id=eq.${encodeURIComponent(providerOrder.external_reference)}&select=id,amount_cents,mp_order_id`);
    if (!local || local.mp_order_id !== id || !confirmedOrder(providerOrder, local.amount_cents, id, local.id))
      return respond(res, 422, { error: 'Order e pedido divergentes' });
    const status = statusFromProvider(providerOrder, local.amount_cents);
    await db('/rpc/record_mp_order', { method: 'POST', body: JSON.stringify({
      p_order: local.id, p_provider_order: id, p_status: status, p_amount_cents: local.amount_cents
    }) });
    return respond(res, 200, { received: true });
  } catch (error) { console.error('order webhook:', error.message); return respond(res, 503, { error: 'Falha temporária. Reenvie a notificação.' }); }
}
