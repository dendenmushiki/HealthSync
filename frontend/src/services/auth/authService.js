import api from '../api/apiClient';
import { getDeviceIdentity, signDeviceMessage } from '../offline/deviceIdentityService';

export async function login(identifier, password) {
  const identity = await getDeviceIdentity();
  const challenge = Array.from(window.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const deviceProof = await signDeviceMessage(identity, challenge);
  const resp = await api.post('/auth/login', {
    username: identifier,
    password,
    device_id: identity.deviceId,
    device_public_key: identity.publicKey,
    device_challenge: challenge,
    device_proof: deviceProof,
  });
  return resp.data;
}

export async function checkDeviceAuthorization(user) {
  if (!user?.user_id || !user?.device_id) {
    throw new Error('The active account and device are required to verify offline authorization.');
  }
  const identity = await getDeviceIdentity({ createIfMissing: false });
  if (!identity) {
    const error = new Error('The saved device authorization key is unavailable on this browser.');
    error.code = 'OFFLINE_DEVICE_IDENTITY_MISSING';
    throw error;
  }
  if (identity.deviceId !== user.device_id) {
    const error = new Error('The registered device identity does not match this account session.');
    error.code = 'OFFLINE_DEVICE_IDENTITY_MISMATCH';
    throw error;
  }
  const challenge = Array.from(window.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const signature = await signDeviceMessage(identity, challenge);
  const response = await api.post('/auth/offline-status', {
    user_id: user.user_id,
    device_id: identity.deviceId,
    challenge,
    signature,
  });
  if (!response.data?.success || response.data.data?.authorized !== true) {
    throw new Error(response.data?.message || 'This device is not authorized.');
  }
  return response.data.data;
}

export async function logout() {
  try {
    if (localStorage.getItem('hs_token')) await api.post('/auth/logout');
  } finally {
    localStorage.removeItem('hs_token');
    localStorage.removeItem('hs_user');
  }
}

export function setAuth(token, user) {
  localStorage.setItem('hs_token', token);
  localStorage.setItem('hs_user', JSON.stringify(user));
}

export function getAuth() {
  const token = localStorage.getItem('hs_token');
  const user = localStorage.getItem('hs_user');
  return { token, user: user ? JSON.parse(user) : null };
}
