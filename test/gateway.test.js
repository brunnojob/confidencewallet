import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validSignature, centsFromDecimal } from '../lib/gateway.js';
import { confirmedOrder } from '../api/payment-webhook.js';
test('signed Orders webhook accepts fresh notification and rejects forged IDs', () => {
  const ts = '1742505638', now = 1742505638000, id = 'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9', request = 'abc', secret = 'secret';
  const v1 = createHmac('sha256', secret).update(`id:${id.toLowerCase()};request-id:${request};ts:${ts};`).digest('hex');
  assert.equal(validSignature(`ts=${ts},v1=${v1}`, request, id, secret, now), true);
  assert.equal(validSignature(`ts=${ts},v1=${v1}`, request, id+'A', secret, now), false);
  assert.equal(validSignature(`ts=${ts},v1=${v1}`, request, id, secret, now + 700000), false);
});
test('decimal money parsing requires exact cents', () => {
  assert.equal(centsFromDecimal('19.99'), 1999);
  assert.equal(centsFromDecimal('19.991'), null);
  assert.equal(centsFromDecimal('0.01'), 1);
});
test('provider order must match local reference and amount', () => {
  const order={id:'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9',external_reference:'some-local-uuid',currency:'BRL',total_amount:'19.99'};
  assert.equal(confirmedOrder(order,1999,order.id,'some-local-uuid'),true);
  assert.equal(confirmedOrder(order,2000,order.id,'some-local-uuid'),false);
  assert.equal(confirmedOrder(order,1999,order.id,'different'),false);
});
