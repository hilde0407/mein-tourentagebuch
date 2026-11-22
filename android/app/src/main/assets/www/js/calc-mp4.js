'use strict';
/* 2.17.0: MP4-Verpackung (ISO-BMFF, „moov am Ende“) für den Video-Export des 3D-Flugs. Läuft im Browser (globales `Mp4`) und in Node (tests/test_calc.js).
   Die Bilddaten kommen fertig kodiert aus WebCodecs (H.264 „avc“ bzw. HEVC „hevc“, Kopfdaten = decoderConfig.description). Sie werden der Reihe nach
   hinausgeschrieben (in die Hülle, Stück für Stück); dieser Schreiber merkt sich nur Größen, Schlüsselbilder und Zeiten. Am Ende entstehen der
   Inhaltsteil (moov) und 8 Bytes, die die Größe des Datenteils (mdat, 64 Bit) vorne nachtragen. Ein Bild je „Chunk“ – so legen es die meisten
   Programme an, jede Abspiel-App kommt damit zurecht. Kein Ton. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const asc = s => Uint8Array.from(String(s), c => c.charCodeAt(0) & 255);
  const cat = parts => {
    let n = 0; for (const p of parts) n += p.length;
    const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; }
    return o;
  };
  const u8 = v => Uint8Array.of(v & 255);
  const u16 = v => Uint8Array.of((v >>> 8) & 255, v & 255);
  const u32 = v => Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const u64 = v => { const hi = Math.floor(v / 4294967296), lo = v - hi * 4294967296; return cat([u32(hi), u32(lo)]); };
  const box = (type, ...parts) => { const body = cat(parts.flat(Infinity)); return cat([u32(body.length + 8), asc(type), body]); };
  const full = (type, ver, flags, ...parts) => box(type, u8(ver), u8(flags >> 16), u16(flags & 65535), ...parts);
  const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32);
  const zeros = n => new Uint8Array(n);

  /** Schreiber für eine Videospur. o = { codec: 'avc' | 'hevc', w, h, fps }.
   *  kopf() → Bytes für den Dateianfang (ftyp + mdat-Kopf); probe(bytes, key, zeitUs) nach jedem kodierten Bild (die Bytes selbst schreibt der Aufrufer);
   *  ende(description) → { moov, patchAt, patch }: moov anhängen, an Stelle patchAt die 8 Bytes patch einsetzen. */
  function schreiber(o) {
    const fps = +o.fps || 30, ts = 90000 % fps === 0 ? 90000 : fps * 1000, dur = ts / fps;
    const hevc = o.codec === 'hevc', groessen = [], keys = [], pts = [], offs = [];
    let pos = 0, ftypLen = 0, fertig = false;
    return {
      timescale: ts,
      kopf() {
        const ftyp = box('ftyp', asc('isom'), u32(512), asc('isom'), asc('iso2'), asc(hevc ? 'hvc1' : 'avc1'), asc('mp41'));
        ftypLen = ftyp.length;
        const mdat = cat([u32(1), asc('mdat'), u64(0)]);      // Größe 1 = 64-Bit-Größe folgt (wird am Ende eingesetzt)
        pos = ftypLen + mdat.length;
        return cat([ftyp, mdat]);
      },
      probe(len, key, zeitUs) {
        if (fertig) throw new Error('Video ist schon abgeschlossen');
        offs.push(pos); groessen.push(len); keys.push(!!key); pts.push(Math.round(zeitUs * ts / 1e6)); pos += len;
      },
      get bilder() { return groessen.length; },
      get bytes() { return pos; },
      ende(desc) {
        if (!groessen.length) throw new Error('Keine Bilder kodiert');
        if (!desc || !desc.length) throw new Error('Der Kodierer hat keine Kopfdaten geliefert');
        fertig = true;
        const n = groessen.length, mdDur = n * dur, msDur = Math.round(mdDur / ts * 1000);
        // Darstellungszeit gegen Dekodierzeit (nur bei umsortierten Bildern nötig)
        let minOff = 0, ctts = false;
        const off = pts.map((p, k) => { const d = p - k * dur; if (d !== 0) ctts = true; if (d < minOff) minOff = d; return d; });
        const shift = -minOff;
        const entry = box(hevc ? 'hvc1' : 'avc1', zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(o.w), u16(o.h), u32(0x00480000), u32(0x00480000),
          u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box(hevc ? 'hvcC' : 'avcC', desc));
        const alleKey = keys.every(Boolean), gross = pos > 4294967295;
        const stbl = box('stbl',
          full('stsd', 0, 0, u32(1), entry),
          full('stts', 0, 0, u32(1), u32(n), u32(dur)),
          alleKey ? [] : full('stss', 0, 0, u32(keys.filter(Boolean).length), keys.map((k, i) => k ? u32(i + 1) : null).filter(Boolean)),
          ctts ? full('ctts', 0, 0, u32(n), off.map(d => [u32(1), u32(d + shift)])) : [],
          full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
          full('stsz', 0, 0, u32(0), u32(n), groessen.map(u32)),
          gross ? full('co64', 0, 0, u32(n), offs.map(u64)) : full('stco', 0, 0, u32(n), offs.map(u32)));
        const minf = box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
        const mdia = box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(mdDur), u16(0x55c4), u16(0)),
          full('hdlr', 0, 0, u32(0), asc('vide'), zeros(12), asc('VideoHandler'), zeros(1)), minf);
        const edts = shift ? box('edts', full('elst', 0, 0, u32(1), u32(msDur), u32(shift), u16(1), u16(0))) : [];
        const trak = box('trak', full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(msDur), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX,
          u32(o.w * 65536), u32(o.h * 65536)), edts, mdia);
        const moov = box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(msDur), u32(0x00010000), u16(0x0100), u16(0), zeros(8), MATRIX, zeros(24), u32(2)), trak);
        return { moov, patchAt: ftypLen + 8, patch: u64(pos - ftypLen), bilder: n, dauerMs: msDur, bytes: pos + moov.length };
      },
    };
  }

  /** Kästen einer MP4-Datei lesen (für Tests): [{ type, at, size, kids }] – Behälter werden geöffnet. */
  const BEHAELTER = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts']);
  function boxen(b, a, e) {
    a = a || 0; e = e == null ? b.length : e;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
    while (a + 8 <= e) {
      let size = dv.getUint32(a), head = 8;
      const type = String.fromCharCode(b[a + 4], b[a + 5], b[a + 6], b[a + 7]);
      if (size === 1) { size = dv.getUint32(a + 8) * 4294967296 + dv.getUint32(a + 12); head = 16; }
      if (size === 0) size = e - a;
      if (size < head || a + size > e) throw new Error('Kasten ' + type + ' kaputt bei ' + a);
      out.push({ type, at: a, size, head, kids: BEHAELTER.has(type) ? boxen(b, a + head, a + size) : null });
      a += size;
    }
    return out;
  }
  function finde(list, pfad) {
    const [k, ...rest] = pfad.split('/');
    const x = (list || []).find(q => q.type === k);
    return !x ? null : rest.length ? finde(x.kids, rest.join('/')) : x;
  }

  const api = { schreiber, boxen, finde };
  if (node) module.exports = api; else root.Mp4 = api;
})(typeof window !== 'undefined' ? window : this);
