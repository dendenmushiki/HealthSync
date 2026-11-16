const DB_NAME = 'healthsync_offline_v1';
const DB_VERSION = 7;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('offlineQueue')) {
        const store = db.createObjectStore('offlineQueue', { keyPath: 'offlineOperationId' });
        store.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('cachedResidents')) {
        db.createObjectStore('cachedResidents', { keyPath: 'resident_id' });
      }
      if (!db.objectStoreNames.contains('syncMetadata')) {
        db.createObjectStore('syncMetadata', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('offlineVaults')) {
        db.createObjectStore('offlineVaults', { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains('offlineData')) {
        const store = db.createObjectStore('offlineData', { keyPath: ['userId', 'collection', 'recordKey'] });
        store.createIndex('byUserCollection', ['userId', 'collection'], { unique: false });
      }
      if (!db.objectStoreNames.contains('offlineDevices')) {
        db.createObjectStore('offlineDevices', { keyPath: 'deviceId' });
      }
      if (!db.objectStoreNames.contains('offlineSecurity')) {
        db.createObjectStore('offlineSecurity', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function addToStore(storeName, value) {
  return withStore(storeName, 'readwrite', (store) => store.add(value));
}

export async function putToStore(storeName, value) {
  return withStore(storeName, 'readwrite', (store) => store.put(value));
}

export async function getFromStore(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllFromStore(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllByIndex(storeName, indexName, query) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const idx = store.index(indexName);
    const req = idx.getAll(query);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFromStore(storeName, key) {
  return withStore(storeName, 'readwrite', (store) => store.delete(key));
}

const indexedDbService = { openDb, addToStore, putToStore, getFromStore, getAllFromStore, getAllByIndex, deleteFromStore };

export default indexedDbService;
