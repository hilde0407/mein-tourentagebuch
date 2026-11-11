'use strict';
/* Auswertung wie in „Meine Touren“: Rekorde, Kalender, Leistung über die Jahre, Aktivitäten, Neuland, Wetter und Jahresziele.
   Jede Funktion bekommt das Element, die gefilterten Touren und {all, year, sport}. Alles rechnet auf dem Handy. */
const Ausw = {
  day: ms => { const d = new Date(ms); return Math.floor((ms - d.getTimezoneOffset() * -60000 * -1) / 86400000); },
  dkey: ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  monday: ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; },
  kpi: (v, l) => h('div', { class: 'kpi' }, h('b', null, v), h('small', null, l)),
  link: (t, main, sub) => h('a', { class: 'li', href: '#/tour/' + t.id }, h('span', { class: 'li-i' }, Sports.icon(t.sport)), h('span', { class: 'li-t' }, h('b', null, main), h('small', null, sub))),
  sec: (title, sub) => [h('h3', null, title), sub ? h('p', { class: 'muted small' }, sub) : null],

  /* ---------- Rekorde ---------- */
  rekorde(body, ts) {
    const real = ts.filter(t => t.dist > 0);
    if (!real.length) { body.append(h('div', { class: 'empty' }, h('p', null, 'Noch keine Touren.'))); return; }
    const group = keyFn => { const m = new Map(); real.forEach(t => { const k = keyFn(t.start); const g = m.get(k) || { k, dist: 0, up: 0, n: 0, first: t.start }; g.dist += t.dist; g.up += t.up || 0; g.n++; g.first = Math.min(g.first, t.start); m.set(k, g); }); return [...m.values()]; };
    const best = (arr, f) => arr.slice().sort((a, b) => f(b) - f(a))[0];
    const days = group(Ausw.dkey), weeks = group(ms => Ausw.monday(ms).getTime()), months = group(ms => { const d = new Date(ms); return d.getFullYear() + '-' + d.getMonth(); }), yrs = group(ms => new Date(ms).getFullYear());
    // Serie aufeinanderfolgender Tage mit Tour
    const ds = [...new Set(real.map(t => Math.round(new Date(new Date(t.start).toDateString()).getTime() / 86400000)))].sort((a, b) => a - b);
    let run = 0, bestRun = 0, runEnd = 0; ds.forEach((d, i) => { run = i && d - ds[i - 1] === 1 ? run + 1 : 1; if (run > bestRun) { bestRun = run; runEnd = d; } });
    const row = (ico, lab, val, sub, href) => h(href ? 'a' : 'div', href ? { class: 'li', href } : { class: 'li' }, h('span', { class: 'li-i' }, ico), h('span', { class: 'li-t' }, h('b', null, lab + ': ' + val), h('small', null, sub || '')));
    const fmtM = k => { const [y, m] = k.split('-'); return new Date(+y, +m, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };
    const d1 = best(days, g => g.dist), w1 = best(weeks, g => g.dist), m1 = best(months, g => g.dist), y1 = best(yrs, g => g.n), y2 = best(yrs, g => g.dist);
    body.append(...Ausw.sec('Zeiträume'), h('div', { class: 'list' },
      row('🏆', 'Bester Tag', F.km(d1.dist), d1.n + (d1.n === 1 ? ' Tour' : ' Touren') + ' am ' + F.date(d1.first)),
      row('🏆', 'Beste Woche', F.km(w1.dist), 'ab ' + F.date(w1.k) + ' · ' + w1.n + ' Touren · ' + F.m(w1.up) + ' Aufstieg'),
      row('🏆', 'Bester Monat', F.km(m1.dist), fmtM(m1.k) + ' · ' + m1.n + ' Touren'),
      row('🏆', 'Meiste Touren in einem Jahr', y1.n, y1.k + ' · ' + F.km(y1.dist)),
      row('🏆', 'Stärkstes Jahr', F.km(y2.dist), y2.k + ' · ' + y2.n + ' Touren · ' + F.m(y2.up) + ' Aufstieg'),
      row('🔥', 'Längste Serie', bestRun + (bestRun === 1 ? ' Tag' : ' Tage') + ' in Folge', 'bis ' + F.date(runEnd * 86400000))));
    const sports = [...new Set(real.map(t => t.sport))];
    const per = [];
    sports.forEach(s => {
      const a = real.filter(t => t.sport === s); if (a.length < 2) return;
      const top = (lab, f, fm) => { const b = a.slice().sort((x, y) => f(y) - f(x))[0]; return f(b) > 0 ? Ausw.link(b, lab + ': ' + fm(b), b.name + ' · ' + F.dshort(b.start)) : null; };
      per.push(h('h3', { class: 'sub' }, Sports.icon(s) + ' ' + Sports.label(s) + ' · ' + a.length + ' Touren'), h('div', { class: 'list' },
        top('Längste', t => t.dist, t => F.km(t.dist)), top('Meiste Höhenmeter', t => t.up, t => F.m(t.up)), top('Höchster Punkt', t => t.maxAlt, t => F.m(t.maxAlt)),
        top('Schnellste', t => t.moving > 600 ? t.dist / t.moving : 0, t => F.speed(t.dist, t.moving)), top('Längste Dauer', t => t.dur, t => F.dur(t.dur))));
    });
    if (per.length) body.append(...Ausw.sec('Je Sportart'), ...per);
  },

  /* ---------- Kalender ---------- */
  kalender(body, ts, ctx) {
    const all = ctx.all, years = [...new Set(all.map(t => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
    let y = ctx.year === 'all' ? (years[0] || new Date().getFullYear()) : ctx.year;
    const wrap = h('div'); body.append(wrap);
    const draw = () => {
      wrap.innerHTML = '';
      const by = new Map(); all.filter(t => new Date(t.start).getFullYear() === y && (!ctx.sport || t.sport === ctx.sport)).forEach(t => { const k = Ausw.dkey(t.start); const a = by.get(k) || []; a.push(t); by.set(k, a); });
      const mx = Math.max(1, ...[...by.values()].map(a => a.reduce((s, t) => s + t.dist, 0)));
      const nav = h('div', { class: 'row' }, h('button', { class: 'btn sm', 'aria-label': 'Vorjahr', onclick: () => { y--; draw(); } }, '‹'), h('b', { class: 'calyear' }, String(y)), h('button', { class: 'btn sm', 'aria-label': 'Folgejahr', onclick: () => { y++; draw(); } }, '›'));
      wrap.append(nav, h('p', { class: 'muted small' }, by.size + ' Tage mit Tour. Je dunkler, desto weiter. Tag antippen für die Touren.'));
      const grid = h('div', { class: 'cal' });
      for (let m = 0; m < 12; m++) {
        const first = new Date(y, m, 1), n = new Date(y, m + 1, 0).getDate(), off = (first.getDay() + 6) % 7;
        const cells = [];
        for (let i = 0; i < off; i++) cells.push(h('i', { class: 'cd none' }));
        for (let d = 1; d <= n; d++) {
          const k = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'), a = by.get(k);
          const km = a ? a.reduce((s, t) => s + t.dist, 0) : 0, lv = a ? 1 + Math.min(3, Math.floor(km / mx * 4)) : 0;
          cells.push(h(a ? 'button' : 'i', a ? { class: 'cd l' + lv, 'aria-label': d + '.' + (m + 1) + '. ' + F.km(km), onclick: () => Ausw.dayList(k, a) } : { class: 'cd' }, String(d)));
        }
        grid.append(h('div', { class: 'cm' }, h('b', null, first.toLocaleDateString('de-DE', { month: 'long' })), h('div', { class: 'cg' }, cells)));
      }
      wrap.append(grid);
    };
    draw();
  },
  dayList(k, list) {
    const s = sheet(F.date(list[0].start), h('div', { class: 'list' }, list.map(t => h('a', { class: 'li', href: '#/tour/' + t.id, onclick: () => s.close() }, h('span', { class: 'li-i' }, Sports.icon(t.sport)), h('span', { class: 'li-t' }, h('b', null, t.name), h('small', null, F.km(t.dist) + ' · ' + F.m(t.up) + ' · ' + F.dur(t.moving || t.dur)))))));
  },

  /* ---------- Auswertung: Aktivitäten, Leistung, Neuland, Wetter ---------- */
  auswertung(body, ts, ctx) {
    if (!ts.length) { body.append(h('div', { class: 'empty' }, h('p', null, 'Keine Touren in diesem Zeitraum.'))); return; }
    // Statistik nach Aktivität
    const rows = Sports.list.map(s => [s[0], ts.filter(t => t.sport === s[0])]).filter(r => r[1].length).sort((a, b) => b[1].reduce((x, t) => x + t.dist, 0) - a[1].reduce((x, t) => x + t.dist, 0));
    const sm = (a, k) => a.reduce((x, t) => x + (t[k] || 0), 0);
    body.append(...Ausw.sec('Statistik nach Aktivität'), h('div', { class: 'tblw' }, h('table', { class: 'cstat' },
      h('thead', null, h('tr', null, ['Aktivität', 'Touren', 'km', 'Aufst. m', 'Ø km', 'Zeit'].map(x => h('th', null, x)))),
      h('tbody', null, rows.map(([k, a]) => h('tr', null, h('td', null, Sports.icon(k) + ' ' + Sports.label(k)), h('td', null, String(a.length)), h('td', null, (sm(a, 'dist') / 1000).toFixed(0)), h('td', null, Math.round(sm(a, 'up')).toLocaleString('de-DE')), h('td', null, (sm(a, 'dist') / a.length / 1000).toFixed(1).replace('.', ',')), h('td', null, F.dur(sm(a, 'moving') || sm(a, 'dur')))))))));
    // Leistung über die Jahre
    const all = ctx.all.filter(t => !ctx.sport || t.sport === ctx.sport);
    const perf = [];
    [...new Set(all.map(t => t.sport))].forEach(s => {
      const byY = {}; all.filter(t => t.sport === s && t.moving > 300 && t.dist > 500).forEach(t => { (byY[new Date(t.start).getFullYear()] = byY[new Date(t.start).getFullYear()] || []).push(t); });
      const ys = Object.keys(byY).filter(y => byY[y].length >= 2).sort();
      if (ys.length < 2) return;
      const spd = ys.map(y => sm(byY[y], 'dist') / sm(byY[y], 'moving') * 3.6), climb = ys.map(y => sm(byY[y], 'up') / (sm(byY[y], 'moving') / 3600));
      const bar = (vals, unit, dec) => { const mx = Math.max(...vals, 1); return h('div', { class: 'hbars' }, ys.map((y, i) => h('div', { class: 'hb' }, h('span', null, y), h('div', null, h('i', { style: { width: (vals[i] / mx * 100) + '%' } })), h('b', null, vals[i].toFixed(dec).replace('.', ',') + ' ' + unit)))); };
      perf.push(h('h3', { class: 'sub' }, Sports.icon(s) + ' ' + Sports.label(s)), h('p', { class: 'muted small' }, 'Ø Tempo (in Bewegung)'), bar(spd, 'km/h', 1), s !== 'bike' && s !== 'racebike' && s !== 'mtb' && s !== 'ebike' ? [h('p', { class: 'muted small' }, 'Höhenmeter pro Stunde'), bar(climb, 'm/h', 0)] : null);
    });
    if (perf.length) body.append(...Ausw.sec('Leistung über die Jahre', 'nur Jahre mit mindestens 2 Touren der Sportart'), ...perf);
    // Neuland und Wetter
    const nl = h('div'), wx = h('div');
    body.append(...Ausw.sec('Neuland', 'Anteil der Strecke, der auf keiner früheren Tour lag (Raster von rund 200 m)'), nl, ...Ausw.sec('Wetter', 'Temperatur und Niederschlag am Tourtag (Open-Meteo, braucht Internet; wird einmal geladen)'), wx);
    Ausw.neuland(nl, ctx); Ausw.wetter(wx, ctx);
  },

  cellKey: (la, lo) => Math.round(la / 0.002) + ',' + Math.round(lo / 0.002),
  async neulandRechnen(onProgress) {
    const tours = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden).slice().sort((a, b) => a.start - b.start);
    const seen = new Set(); let n = 0;
    for (const t of tours) {
      const r = await DB.get('tracks', t.id); const mine = new Set();
      if (r) for (let i = 0; i < r.lat.length; i++) mine.add(Ausw.cellKey(r.lat[i], r.lon[i]));
      let nw = 0; mine.forEach(c => { if (!seen.has(c)) nw++; });
      const pct = mine.size ? Math.round(nw / mine.size * 100) : 0;
      if (t.nlNew !== pct || t.nlCells !== mine.size) { t.nlNew = pct; t.nlCells = mine.size; await Tours.save(t); }
      mine.forEach(c => seen.add(c)); n++;
      if (onProgress && n % 5 === 0) { onProgress(n, tours.length); await new Promise(r => setTimeout(r, 0)); }
    }
    Tours.invalidate(); return { tours: n, cells: seen.size };
  },
  neuland(el, ctx) {
    const draw = () => {
      el.innerHTML = '';
      const ts = ctx.all.filter(t => t.nlCells != null);
      const todo = ctx.all.filter(t => t.nlCells == null).length;
      const btn = h('button', { class: 'btn' + (todo ? ' pri' : ''), onclick: async () => {
        btn.disabled = true; try { await Ausw.neulandRechnen((i, n) => { btn.textContent = 'Berechne ' + i + '/' + n + ' …'; }); } catch (e) { toast(e.message, 6000); }
        const all2 = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden); ctx.all.splice(0, ctx.all.length, ...all2); draw(); } }, todo ? 'Berechnen' + (ts.length ? ' (' + todo + ' neue)' : '') : 'Neu berechnen');
      if (!ts.length) { el.append(h('p', { class: 'muted' }, 'Noch nicht berechnet.'), btn); return; }
      const years = [...new Set(ts.map(t => new Date(t.start).getFullYear()))].sort();
      const avg = y => { const a = ts.filter(t => new Date(t.start).getFullYear() === y); return a.reduce((s, t) => s + t.nlNew * t.nlCells, 0) / (a.reduce((s, t) => s + t.nlCells, 0) || 1); };
      el.append(h('div', { class: 'hbars' }, years.map(y => h('div', { class: 'hb' }, h('span', null, String(y)), h('div', null, h('i', { style: { width: avg(y) + '%' } })), h('b', null, Math.round(avg(y)) + ' %')))));
      const tops = ts.filter(t => t.nlCells >= 10).sort((a, b) => b.nlNew * b.nlCells - a.nlNew * a.nlCells).slice(0, 5);
      el.append(h('h3', { class: 'sub' }, 'Größte Entdeckungen'), h('div', { class: 'list' }, tops.map(t => Ausw.link(t, t.name, t.nlNew + ' % neu · ' + F.km(t.dist) + ' · ' + F.dshort(t.start)))), btn);
    };
    draw();
  },

  wxRows: ts => ts.filter(t => t.wxT != null),
  async wetterLaden(tours, onProgress) {
    let ok = 0, fail = 0;
    for (let i = 0; i < tours.length; i++) {
      const t = tours[i]; if (onProgress) onProgress(i + 1, tours.length);
      try {
        const d = Ausw.dkey(t.start);
        const r = await Native.http({ url: `https://archive-api.open-meteo.com/v1/archive?latitude=${t.lat.toFixed(3)}&longitude=${t.lon.toFixed(3)}&start_date=${d}&end_date=${d}&daily=temperature_2m_mean,temperature_2m_max,precipitation_sum&timezone=auto` });
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        const j = JSON.parse(r.body).daily; if (!j || j.temperature_2m_mean == null || j.temperature_2m_mean[0] == null) throw new Error('keine Daten');
        t.wxT = Math.round(j.temperature_2m_mean[0] * 10) / 10; t.wxMax = j.temperature_2m_max[0]; t.wxP = Math.round((j.precipitation_sum[0] || 0) * 10) / 10;
        await Tours.save(t); ok++;
      } catch (e) { fail++; if (/HTTP 429/.test(e.message)) break; }
      await new Promise(r => setTimeout(r, 120));
    }
    Tours.invalidate(); return { ok, fail };
  },
  wetter(el, ctx) {
    const draw = () => {
      el.innerHTML = '';
      const have = Ausw.wxRows(ctx.all), todo = ctx.all.filter(t => t.wxT == null && t.start && t.lat != null && !t.wxFail);
      const btn = h('button', { class: 'btn' + (have.length ? '' : ' pri'), onclick: async () => {
        btn.disabled = true; const batch = todo.slice(0, 150);
        try { const r = await Ausw.wetterLaden(batch, (i, n) => { btn.textContent = 'Lade ' + i + '/' + n + ' …'; }); toast(r.ok + ' Touren mit Wetter' + (r.fail ? ' · ' + r.fail + ' ohne Daten' : '')); } catch (e) { toast(e.message, 6000); }
        const all2 = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden); ctx.all.splice(0, ctx.all.length, ...all2); draw(); } }, todo.length ? (have.length ? 'Weitere laden (' + Math.min(150, todo.length) + ' von ' + todo.length + ')' : 'Wetter laden') : 'Alles geladen');
      if (!todo.length) btn.disabled = true;
      if (!have.length) { el.append(btn); return; }
      const buckets = [['unter 0 °', t => t.wxT < 0], ['0 – 10 °', t => t.wxT >= 0 && t.wxT < 10], ['10 – 20 °', t => t.wxT >= 10 && t.wxT < 20], ['20 – 30 °', t => t.wxT >= 20 && t.wxT < 30], ['über 30 °', t => t.wxT >= 30]];
      const counts = buckets.map(([l, f]) => [l, have.filter(f).length]), mx = Math.max(...counts.map(c => c[1]), 1);
      const rain = have.filter(t => t.wxP >= 1).length;
      el.append(h('p', { class: 'muted small' }, have.length + ' Touren mit Wetterdaten'), h('p', { class: 'muted small' }, 'Bei welcher Tagesmitteltemperatur bist du unterwegs?'),
        h('div', { class: 'hbars' }, counts.map(([l, c]) => h('div', { class: 'hb' }, h('span', null, l), h('div', null, h('i', { style: { width: (c / mx * 100) + '%' } })), h('b', null, String(c))))),
        h('div', { class: 'kpis' }, Ausw.kpi(Math.round(rain / have.length * 100) + ' %', 'an Regentagen (≥ 1 mm)'), Ausw.kpi(Math.min(...have.map(t => t.wxT)).toFixed(0) + ' °', 'kältester Tag'), Ausw.kpi(Math.max(...have.map(t => t.wxMax != null ? t.wxMax : t.wxT)).toFixed(0) + ' °', 'wärmster Tag')));
      const kalt = have.slice().sort((a, b) => a.wxT - b.wxT)[0], nass = have.slice().sort((a, b) => b.wxP - a.wxP)[0];
      el.append(h('div', { class: 'list' }, Ausw.link(kalt, 'Kälteste Tour: ' + kalt.wxT + ' °', kalt.name + ' · ' + F.dshort(kalt.start)), nass.wxP > 0 ? Ausw.link(nass, 'Nassester Tag: ' + nass.wxP + ' mm', nass.name + ' · ' + F.dshort(nass.start)) : null), btn);
    };
    draw();
  },

  /* ---------- Jahresziele ---------- */
  async ziele(body, ts, ctx) {
    const years = [...new Set(ctx.all.map(t => new Date(t.start).getFullYear()))]; const now = new Date().getFullYear(); if (!years.includes(now)) years.push(now);
    years.sort((a, b) => b - a);
    let y = ctx.year === 'all' ? now : ctx.year;
    const goals = await DB.kvGet('goals', {});
    const wrap = h('div'); body.append(wrap);
    const draw = () => {
      wrap.innerHTML = '';
      const g = goals[y] || {};
      const done = ctx.all.filter(t => new Date(t.start).getFullYear() === y && (!ctx.sport || t.sport === ctx.sport));
      const cur = { km: done.reduce((s, t) => s + t.dist, 0) / 1000, up: done.reduce((s, t) => s + (t.up || 0), 0), n: done.length };
      const jan1 = new Date(y, 0, 1).getTime(), dec31 = new Date(y + 1, 0, 1).getTime(), frac = Math.min(1, Math.max(0, (Date.now() - jan1) / (dec31 - jan1)));
      const inp = k => h('input', { type: 'text', inputmode: 'numeric', value: g[k] || '', placeholder: 'kein Ziel', onchange: async e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v) && v > 0) goals[y] = Object.assign(goals[y] || {}, { [k]: v }); else if (goals[y]) delete goals[y][k]; await DB.kvSet('goals', goals); draw(); } });
      const line = (k, lab, unit, fmt) => {
        const goal = g[k], c = cur[k], pct = goal ? Math.min(100, c / goal * 100) : 0, pace = frac > 0.02 ? c / frac : null, soll = goal ? goal * frac : 0;
        return h('div', { class: 'goal' }, h('label', { class: 'fld' }, lab + ' (' + unit + ')', inp(k)),
          goal ? h('div', null, h('div', { class: 'gbar' }, h('i', { style: { width: pct + '%' } }), y === now ? h('u', { style: { left: (frac * 100) + '%' }, title: 'Soll heute' }) : null),
            h('p', { class: 'muted small' }, fmt(c) + ' von ' + fmt(goal) + ' · ' + Math.round(c / goal * 100) + ' %' + (y === now ? ' · Soll heute ' + fmt(soll) + (c >= soll ? ' ✓ im Plan' : ' · ' + fmt(soll - c) + ' im Rückstand') + (pace ? ' · Hochrechnung ' + fmt(pace) : '') : '')))
            : h('p', { class: 'muted small' }, 'Bisher ' + fmt(c)));
      };
      wrap.append(h('div', { class: 'row' }, h('button', { class: 'btn sm', 'aria-label': 'Vorjahr', onclick: () => { y--; draw(); } }, '‹'), h('b', { class: 'calyear' }, String(y)), h('button', { class: 'btn sm', 'aria-label': 'Folgejahr', onclick: () => { y++; draw(); } }, '›')),
        h('p', { class: 'muted small' }, 'Lege Ziele für das Jahr fest. Der Strich im Balken zeigt, wo du heute stehen müsstest.'),
        line('km', 'Kilometer', 'km', v => Math.round(v).toLocaleString('de-DE') + ' km'), line('up', 'Höhenmeter', 'm', v => Math.round(v).toLocaleString('de-DE') + ' m'), line('n', 'Touren', 'Anzahl', v => Math.round(v) + ' Touren'));
    };
    draw();
  },
};
