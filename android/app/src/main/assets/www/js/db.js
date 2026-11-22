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
    photoMargin: 20, camOffset: '', guide: true, units: 'km', komootEmail: '', stravaId: '', homeLat: '', homeLon: '', homeName: '', hrMax: '',
    backupDays: 14, birthYear: '', homeShow: {}, bestN: 1,
    mtZahlen: true, zeppEle: true, autoAbgleich: false, mtAuto: false, komootPlanned: false,      // 2.1.0: Zahlen aus Meine Touren übernehmen; Höhen der Uhr beim Zepp-Import übernehmen
    panoHinweisAus: false,      // 2.8.0: Hinweis vor „Panorama“ (Modus in der Kamera wählen) nicht mehr zeigen
    videoLimit: '120', videoGallery: true, videoAuto: false,      // 2.9.0: längste Video-Aufnahme (Sekunden, '0' = unbegrenzt), Kopie in die Galerie, HEVC automatisch umwandeln
    backupAuto: false,      // 2.10.0: beim Start höchstens einmal am Tag eine .mtl in den Sicherungsordner (SAF)
    offlineWifi: true, tileMerken: true, offlineStufe: 'normal',      // 2.11.0: Offline-Karten nur über WLAN laden; gesehene Kacheln merken; Detailstufe (bis Zoom 15)
    fotoSkipDup: true,      // 2.14.0: beim Foto-Import schon vorhandene Fotos überspringen (gleicher Abdruck, gleicher Name + Zeit + Größe)
    pdfKarte: true,      // 2.6.0: Karte (OpenStreetMap-Kacheln) im Tour-PDF; aus = Streckenskizze wie in 2.5.0
  },
  async load() { this.v = Object.assign({}, this.defaults, await DB.kvGet('settings', {})); },
  get(k) { return this.v[k]; },
  async set(k, val) { this.v[k] = val; await DB.kvSet('settings', this.v); },
};
