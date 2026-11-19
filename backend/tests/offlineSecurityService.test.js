const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  isDevicePinEnrolled,
  verifyDeviceSignature,
} = require('../src/services/offlineSecurityService');

test('keeps legacy device PIN state visible until an account PIN is introduced', () => {
  assert.equal(isDevicePinEnrolled({
    pinHash: 'legacy-hash',
    pinVersion: 0,
    accountPinHash: null,
    accountPinVersion: 0,
  }), true);
});

test('uses the account PIN version instead of a device PIN verifier', () => {
  assert.equal(isDevicePinEnrolled({
    pinHash: 'legacy-device-hash',
    pinVersion: 1,
    accountPinHash: 'shared-hash',
    accountPinVersion: 2,
  }), false);
  assert.equal(isDevicePinEnrolled({
    pinHash: 'unrelated-legacy-hash',
    pinVersion: 2,
    accountPinHash: 'shared-hash',
    accountPinVersion: 2,
  }), true);
  assert.equal(isDevicePinEnrolled({
    pinHash: null,
    pinVersion: 2,
    accountPinHash: 'shared-hash',
    accountPinVersion: 2,
  }), true);
  assert.equal(isDevicePinEnrolled({
    pinHash: 'legacy-device-hash',
    pinVersion: 0,
    accountPinHash: 'shared-hash',
    accountPinVersion: 2,
  }), false);
  assert.equal(isDevicePinEnrolled({
    pinHash: null,
    pinVersion: 2,
    accountPinHash: null,
    accountPinVersion: 0,
  }), false);
});

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
