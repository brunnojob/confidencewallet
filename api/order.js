import { configured, db, respond } from '../lib/gateway.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req, res) {
  if (req.method !== 'GET') return respond(res, 405, { error: 'Método inválido' });
  if (!configured()) return respond(res, 503, { error: 'Checkout indisponível' });
  if (!uuid.test(req.query.id || '')) return respond(res, 400, { error: 'Pedido inválido' });
  try {
    const [order] = await db(`/checkout_orders?id=eq.${req.query.id}&select=id,status,amount_cents,created_at`);
    return order ? respond(res, 200, order) : respond(res, 404, { error: 'Pedido não encontrado' });
  } catch (error) { console.error('order query:', error.message); return respond(res, 503, { error: 'Consulta indisponível' }); }
}
