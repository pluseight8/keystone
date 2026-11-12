/** IndexedDB-backed state boundary for bounded local binary/object stores. */
export class DesktopIndexedDbStateStore {
  private static readonly databases = new Map<string, Promise<IDBDatabase>>();

  constructor(private readonly key: string, private readonly databaseName = 'keystone-local-state-v1') {}

  async read(): Promise<unknown | undefined> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable on this desktop host');
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const request = database.transaction('state', 'readonly').objectStore('state').get(this.key);
      request.onsuccess = () => resolve(request.result === undefined ? undefined : structuredClone(request.result));
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
  }

  async write(value: unknown): Promise<void> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable on this desktop host');
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
      transaction.objectStore('state').put(value, this.key);
    });
  }

  async update(transform: (current: unknown) => unknown): Promise<void> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable on this desktop host');
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      const store = transaction.objectStore('state');
      const request = store.get(this.key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
      request.onsuccess = () => {
        try {
          store.put(transform(request.result), this.key);
        } catch (reason) {
          reject(reason);
          transaction.abort();
        }
      };
    });
  }

  async delete(): Promise<void> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable on this desktop host');
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB delete failed'));
      transaction.objectStore('state').delete(this.key);
    });
  }

  private database(): Promise<IDBDatabase> {
    const existing = DesktopIndexedDbStateStore.databases.get(this.databaseName);
    if (existing) return existing;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    DesktopIndexedDbStateStore.databases.set(this.databaseName, pending);
    void pending.catch(() => DesktopIndexedDbStateStore.databases.delete(this.databaseName));
    return pending;
  }
}
