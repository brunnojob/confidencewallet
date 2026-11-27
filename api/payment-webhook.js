import { cents, configured, db, mp, respond, validSignature } from '../lib/gateway.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { error: 'Método inválido' });
  if (!configured()) return respond(res, 503, { error: 'Webhook não configurado' });
  const id = req.query['data.id'];
  if (req.query.type !== 'payment' || !/^\d{1,20}$/.test(String(id || '')) ||
      (req.body?.data?.id && String(req.body.data.id) !== String(id))) return respond(res, 400, { error: 'Notificação inválida' });
  if (!validSignature(req.headers['x-signature'], req.headers['x-request-id'], id, process.env.MP_WEBHOOK_SECRET))
    return respond(res, 401, { error: 'Assinatura inválida' });
  try {
    const payment = await mp(`/v1/payments/${id}`);
    if (String(payment.id) !== String(id) || !['approved', 'pending', 'in_process', 'rejected', 'cancelled', 'refunded', 'charged_back'].includes(payment.status))
      return respond(res, 422, { error: 'Pagamento inesperado' });
    const amountCents = cents(payment.transaction_amount);
    if (amountCents == null || payment.currency_id !== 'BRL') return respond(res, 422, { error: 'Valor ou moeda inválidos' });
    const [order] = await db(`/checkout_orders?id=eq.${payment.external_reference}&select=id,amount_cents,mp_preference_id`);
    if (!order || !order.mp_preference_id || order.amount_cents !== amountCents ||
        (payment.preference_id && String(order.mp_preference_id) !== String(payment.preference_id)))
      return respond(res, 422, { error: 'Pedido e pagamento divergentes' });
    await db('/rpc/record_mp_payment', { method: 'POST', body: JSON.stringify({
      p_order: order.id, p_payment: String(payment.id), p_status: payment.status, p_amount_cents: amountCents
    }) });
    return respond(res, 200, { received: true });
  } catch (error) { console.error('payment webhook:', error.message); return respond(res, 503, { error: 'Falha temporária. Reenvie a notificação.' }); }
}
