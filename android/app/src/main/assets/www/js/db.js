'use strict';
/* Lokale Datenbank (IndexedDB): Touren, Spuren, Fotos, Einstellungen. Alles bleibt auf dem Gerät. */
const DB = {
  db: null,
  open() {
    return new Promise((ok, fail) => {
      const r = indexedDB.open('tourentagebuch', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        const t = d.createObjectStore('tours', { keyPath: 'id' });
        t.createIndex('start', 'start'); t.createIndex('srcId', 'srcId');
        d.createObjectStore('tracks', { keyPath: 'id' });
        const p = d.createObjectStore('photos', { keyPath: 'id' });
        p.createIndex('ts', 'ts'); p.createIndex('tour', 'tour');
        d.createObjectStore('kv', { keyPath: 'k' });
      };
      r.onsuccess = () => { DB.db = r.result; ok(); };
      r.onerror = () => fail(r.error);
    });
  },
  _tx(store, mode, fn) {
    return new Promise((ok, fail) => {
      const tx = DB.db.transaction(store, mode);
      let res;
      tx.oncomplete = () => ok(res);
      tx.onerror = tx.onabort = () => fail(tx.error);
      res = fn(tx.objectStore(store), tx);
    }).then(x => x);
  },
  _req(r) { return new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); }); },
  get: (s, k) => DB._req(DB.db.transaction(s).objectStore(s).get(k)),
  all: s => DB._req(DB.db.transaction(s).objectStore(s).getAll()),
  count: s => DB._req(DB.db.transaction(s).objectStore(s).count()),
  byIndex: (s, i, v) => DB._req(DB.db.transaction(s).objectStore(s).index(i).getAll(v)),
  range: (s, i, a, b) => DB._req(DB.db.transaction(s).objectStore(s).index(i).getAll(IDBKeyRange.bound(a, b))),
  put(s, v) { return DB._tx(s, 'readwrite', st => { st.put(v); }); },
  putMany(s, arr) { return DB._tx(s, 'readwrite', st => { arr.forEach(v => st.put(v)); }); },
  del(s, k) { return DB._tx(s, 'readwrite', st => { st.delete(k); }); },
  clear(s) { return DB._tx(s, 'readwrite', st => { st.clear(); }); },
  async kvGet(k, def) { const r = await DB.get('kv', k); return r ? r.v : def; },
  kvSet(k, v) { return DB.put('kv', { k, v }); },
};
const Set_ = {   // Einstellungen mit Vorgabewerten (im Speicher gespiegelt)
  v: {},
  defaults: {
    tiles: 'osm', tileUrl: '', tileKey: '', routeUrl: 'https://brouter.de/brouter', routeProfile: '',
    photoMargin: 20, camOffset: '', guide: true, units: 'km', komootEmail: '', stravaId: '', homeLat: '', homeLon: '',
  },
  async load() { this.v = Object.assign({}, this.defaults, await DB.kvGet('settings', {})); },
  get(k) { return this.v[k]; },
  async set(k, val) { this.v[k] = val; await DB.kvSet('settings', this.v); },
};
