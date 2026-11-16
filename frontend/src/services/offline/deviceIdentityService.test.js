import { TextDecoder, TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import idb from './indexedDbService';
import {
  getDeviceIdentity,
  signDeviceMessage,
  verifyDevicePossession,
} from './deviceIdentityService';

const identities = new Map();

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
  Object.defineProperty(globalThis, 'TextDecoder', { configurable: true, value: TextDecoder });
});

beforeEach(() => {
  identities.clear();
  localStorage.clear();
  idb.addToStore = jest.fn(async (store, identity) => identities.set(identity.deviceId, identity));
  idb.getFromStore = jest.fn(async (store, deviceId) => identities.get(deviceId));
  idb.deleteFromStore = jest.fn(async (store, deviceId) => identities.delete(deviceId));
});

test('persists a nonextractable private key and verifies its signed device challenge', async () => {
  const identity = await getDeviceIdentity();
  const challenge = 'device-challenge-for-offline-authorization';
  const signature = await signDeviceMessage(identity, challenge);

  expect(identity.privateKey.extractable).toBe(false);
  expect(await verifyDevicePossession(identity.deviceId)).toBe(true);
  expect(idb.addToStore).toHaveBeenCalledWith('offlineDevices', identity);
  expect(signature).toBeTruthy();
});
