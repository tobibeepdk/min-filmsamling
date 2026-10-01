import { openDB } from 'idb';

export const DATABASE_NAME = 'filmsamling-v2';
export const STORES = ['movies', 'drafts', 'barcodeMap', 'settings', 'coverBlobs', 'session'];

/** All stores use stable string IDs so the same database works offline and in backups. */
export async function openDatabase(name = DATABASE_NAME) {
  let connection;
  connection = await openDB(name, 1, {
    upgrade(db) {
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
    },
    blocking() {
      // A future schema upgrade should be able to proceed from another app tab.
      connection?.close();
    },
  });
  return connection;
}
