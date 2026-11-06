'use strict';

const crypto = require('crypto');

function computeHmacHex(envelopeString, secret) {
  return crypto.createHmac('sha256', secret).update(envelopeString).digest('hex');
}

function createToken({ payload, secret, ttlMs = 300000, nonce } = {}) {
  const envelope = {
    payload,
    exp: Date.now() + ttlMs,
    nonce: nonce || crypto.randomBytes(16).toString('hex'),
  };

  const envelopeString = JSON.stringify(envelope);
  const hmacHex = computeHmacHex(envelopeString, secret);

  return `${Buffer.from(envelopeString).toString('base64url')}.${hmacHex}`;
}

function verifyToken({ token, secret, nonceStore } = {}) {
  if (!secret || typeof secret !== 'string') {
    return { valid: false, error: 'invalid_secret' };
  }

  if (!nonceStore || typeof nonceStore.has !== 'function') {
    return { valid: false, error: 'nonce_store_required' };
  }

  try {
    if (typeof token !== 'string' || (token.match(/\./g) || []).length !== 1) {
      return { valid: false, error: 'malformed_token' };
    }

    const [encodedEnvelope, hmacHex] = token.split('.');
    if (!encodedEnvelope || !hmacHex) {
      return { valid: false, error: 'malformed_token' };
    }

    let envelopeString;
    try {
      envelopeString = Buffer.from(encodedEnvelope, 'base64url').toString('utf8');
    } catch (err) {
      return { valid: false, error: 'malformed_token' };
    }

    const expectedHmacHex = computeHmacHex(envelopeString, secret);

    const bufExpected = Buffer.from(expectedHmacHex, 'hex');
    const bufActual = Buffer.from(hmacHex, 'hex');

    if (bufExpected.length !== bufActual.length) {
      return { valid: false, error: 'invalid_signature' };
    }

    if (!crypto.timingSafeEqual(bufExpected, bufActual)) {
      return { valid: false, error: 'invalid_signature' };
    }

    let envelope;
    try {
      envelope = JSON.parse(envelopeString);
    } catch (err) {
      return { valid: false, error: 'malformed_token' };
    }

    if (!envelope || typeof envelope.exp !== 'number' || Date.now() > envelope.exp) {
      return { valid: false, error: 'token_expired' };
    }

    if (nonceStore.has(envelope.nonce)) {
      return { valid: false, error: 'nonce_replayed' };
    }

    if (typeof nonceStore.add === 'function') {
      nonceStore.add(envelope.nonce);
    } else if (typeof nonceStore.set === 'function') {
      nonceStore.set(envelope.nonce, true);
    }

    return { valid: true, payload: envelope.payload };
  } catch (err) {
    return { valid: false, error: 'malformed_token' };
  }
}

module.exports = { createToken, verifyToken };
