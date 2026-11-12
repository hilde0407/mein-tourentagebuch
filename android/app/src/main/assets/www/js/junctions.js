'use strict';
/** Wegkreuzungen entlang einer Route aus OpenStreetMap holen. Die Sprachansage meldet Abbiegungen nur noch an solchen Stellen. */
const Junctions = {
  async fetch(sp) {
    const out = [];
    const seg = (p, a, b) => {      // Abstand Punkt–Strecke in Metern (lokal eben)
      const k = Math.cos(a.lat * Math.PI / 180), x = (p.lon - a.lon) * 111320 * k, y = (p.lat - a.lat) * 110540, dx = (b.lon - a.lon) * 111320 * k, dy = (b.lat - a.lat) * 110540;
      const l2 = dx * dx + dy * dy, u = l2 ? Math.max(0, Math.min(1, (x * dx + y * dy) / l2)) : 0;
      return Math.hypot(x - u * dx, y - u * dy);
    };
    const near = p => { for (let i = 1; i < sp.length; i++) if (seg(p, sp[i - 1], sp[i]) <= 25) return true; return false; };
    for (let s = 0; s < sp.length; s += 350) {
      const part = sp.slice(Math.max(0, s - 1), s + 351);
      if (part.length < 2) continue;
      const b = Geo.bbox(part), pad = 0.0004;
      const q = `[out:json][timeout:40];way(${b[0] - pad},${b[1] - pad},${b[2] + pad},${b[3] + pad})["highway"]["highway"!~"proposed|construction|corridor|platform|elevator"];out body;>;out skel qt;`;
      const r = await Native.http({ url: 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), headers: { 'User-Agent': 'MeinTourentagebuch/1.0' } });
      if (r.status !== 200) throw new Error('Overpass: HTTP ' + r.status);
      const els = JSON.parse(r.body).elements || [];
      const xy = {}, cnt = {};
      els.forEach(e => { if (e.type === 'node') xy[e.id] = e; });
      els.forEach(e => { if (e.type === 'way' && e.nodes) { const seen = new Set(e.nodes); seen.forEach(n => { cnt[n] = (cnt[n] || 0) + 1; }); } });
      Object.keys(cnt).forEach(id => { const n = xy[id]; if (cnt[id] >= 2 && n && near(n)) out.push(n.lat.toFixed(6) + ',' + n.lon.toFixed(6)); });
    }
    return out;
  },
  /** Im Hintergrund laden und der Hülle geben; ohne Netz bleibt es bei den deutlichen Abbiegungen. */
  async load(sp) {
    if (!window.MTApp || !MTApp.setJunctions) return;
    try { const j = await Junctions.fetch(sp); MTApp.setJunctions(j.join(';')); }
    catch (e) { /* ohne Kreuzungsdaten: nur deutliche Abbiegungen */ }
  },
};
