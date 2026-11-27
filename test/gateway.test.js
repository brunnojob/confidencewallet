import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validSignature, cents } from '../lib/gateway.js';
test('webhook accepts an authentic fresh signature and rejects tampering', () => {
  const ts = '1742505638', now = 1742505638000, id = '123456', request = 'abc', secret = 'secret';
  const v1 = createHmac('sha256', secret).update(`id:${id};request-id:${request};ts:${ts};`).digest('hex');
  assert.equal(validSignature(`ts=${ts},v1=${v1}`, request, id, secret, now), true);
  assert.equal(validSignature(`ts=${ts},v1=${v1}`, request, '123457', secret, now), false);
  assert.equal(validSignature(`ts=${ts},v1=${v1}`, request, id, secret, now + 700000), false);
});
test('amounts must be exact cents', () => {
  assert.equal(cents(19.99), 1999);
  assert.equal(cents(19.991), null);
});
