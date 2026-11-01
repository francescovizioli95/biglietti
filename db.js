// Archivio locale su IndexedDB (resta sul telefono)
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('biglietti', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('cards', mode);
      const store = t.objectStore('cards');
      const r = fn(store);
      t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  return {
    all: () => tx('readonly', (s) => s.getAll()),
    get: (id) => tx('readonly', (s) => s.get(id)),
    put: (card) => tx('readwrite', (s) => s.put(card)),
    del: (id) => tx('readwrite', (s) => s.delete(id)),
  };
})();
