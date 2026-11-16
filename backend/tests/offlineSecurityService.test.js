const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyDeviceSignature } = require('../src/services/offlineSecurityService');

test('verifies browser-compatible P-256 device signatures and rejects tampering', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const challenge = crypto.randomBytes(32).toString('hex');
  const signature = crypto.sign('sha256', Buffer.from(challenge), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  assert.equal(verifyDeviceSignature(publicKeyPem, challenge, signature), true);
  assert.equal(verifyDeviceSignature(publicKeyPem, `${challenge}tampered`, signature), false);
});
