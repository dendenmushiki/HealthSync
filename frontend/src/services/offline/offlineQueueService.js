import idb from './indexedDbService';
import { v4 as uuidv4 } from 'uuid';

export async function enqueueOperation({ operation, module, table, payload, userId, photo = null, photoAction = null, request = null }) {
  const item = {
    offlineOperationId: uuidv4(),
    operation,
    module,
    table,
    payload,
    createdAt: new Date().toISOString(),
    userId: userId || null,
    photo,
    photoAction,
    request,
    status: 'PENDING',
    retryCount: 0,
  };
  await idb.addToStore('offlineQueue', item);
  return item;
}

export async function getPendingOperations() {
  const operations = await idb.getAllFromStore('offlineQueue');
  if (!Array.isArray(operations)) return [];
  return operations.filter((item) => item.status === 'PENDING' || item.status === 'FAILED');
}

export async function updateOperationStatus(offlineOperationId, updates) {
  const existing = await idb.getFromStore('offlineQueue', offlineOperationId);
  if (!existing) return null;
  const merged = { ...existing, ...updates };
  await idb.putToStore('offlineQueue', merged);
  return merged;
}

const offlineQueueService = { enqueueOperation, getPendingOperations, updateOperationStatus };

export default offlineQueueService;
