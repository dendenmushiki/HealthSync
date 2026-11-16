import idb from './indexedDbService';

const DEVICE_ID_KEY = 'hs_offline_device_id';

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function createDeviceId() {
  if (typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function createIdentity() {
  if (!window.crypto?.subtle) throw new Error('Secure device authorization is unavailable in this browser.');
  const pair = await window.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify']
  );
  const publicDer = new Uint8Array(await window.crypto.subtle.exportKey('spki', pair.publicKey));
  const deviceId = createDeviceId();
  const publicKey = `-----BEGIN PUBLIC KEY-----\n${bytesToBase64(publicDer)}\n-----END PUBLIC KEY-----`;
  const identity = { deviceId, publicKey, privateKey: pair.privateKey };
  await idb.addToStore('offlineDevices', identity);
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
  return identity;
}

export async function getDeviceIdentity() {
  const deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (deviceId) {
    const identity = await idb.getFromStore('offlineDevices', deviceId);
    if (identity?.privateKey && identity.publicKey) return identity;
  }
  return createIdentity();
}

export async function signDeviceMessage(identity, message) {
  const signature = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    new TextEncoder().encode(message)
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyDevicePossession(deviceId) {
  const identity = await idb.getFromStore('offlineDevices', deviceId);
  if (!identity?.privateKey || !identity.publicKey) return false;
  const challenge = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(32)));
  const signature = await signDeviceMessage(identity, challenge);
  const publicDer = window.atob(identity.publicKey
    .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ''));
  const publicBytes = Uint8Array.from(publicDer, (character) => character.charCodeAt(0));
  const publicKey = await window.crypto.subtle.importKey(
    'spki',
    publicBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const signatureBytes = Uint8Array.from(window.atob(signature), (character) => character.charCodeAt(0));
  return window.crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signatureBytes,
    new TextEncoder().encode(challenge)
  );
}

export async function clearDeviceIdentity() {
  const deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (deviceId) await idb.deleteFromStore('offlineDevices', deviceId);
  localStorage.removeItem(DEVICE_ID_KEY);
}
