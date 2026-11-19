# Erzeugt calc-erwartet.json aus den Python-Vorbildern der Schwester-App (Meine Touren). Aufruf: TZ=Europe/Berlin MEINE_TOUREN=/pfad/zu/meine-touren python3 calc-erwartet-erzeugen.py
import json, sys
from datetime import date, datetime, timedelta
sys.path.insert(0, __import__('os').environ.get('MEINE_TOUREN', '/home/claude/meine-touren'))
import app.planhilfe as p, app.fitness as f, app.tourrueckblick as r
out = {}
H = date(2026, 11, 20)
cases = [
 (47.5, 11.2, '2026-06-21', '09:00', 5.0, 20),
 (47.5, 11.2, '2026-03-29', '01:00', 4.0, 0),
 (47.5, 11.2, '2026-10-25', '00:30', 5.0, 0),
 (47.5, 11.2, '2026-12-21', '09:00', 6.0, 20),
 (47.5, 11.2, '2026-12-21', None, 5.0, None),
 (70.0, 20.0, '2026-06-21', '09:00', 5.0, 20),
 (70.0, 20.0, '2026-12-21', '09:00', 5.0, 20),
 (47.5, 11.2, '2026-07-10', '20:00', 8.0, 20),
 (47.5, 11.2, '2026-09-15', '07:30', 8.5, 20),
 (-33.9, 18.4, '2026-06-21', '09:00', 4.0, 20),
 (47.5, 11.2, None, None, 3.0, None),
 (47.5, 11.2, '2026-05-01', '05:00', 9.0, 10),
]
out['tageslicht'] = [{'in': list(c), 'out': p.tageslicht(c[0], c[1], c[2], c[3], c[4], c[5], H)} for c in cases]
# metrik
ms = []
for w, vals in [(10, [8, 9, 10, 11, 12]), (20, [8, 9, 10, 11, 12]), (5, [8, 9, 10, 11, 12]), (12.5, [10, 10, 10, 10, 10, 20]), (10, [10]*5), (0, [0]*5), (7, [3,4,5,6,7,8,9,10]), (13, [10, 10, 10, 10, 10, 10]), (12, [10]*5), (8, [10]*5)]:
    ms.append({'in': [w, vals], 'out': p._metrik(w, vals)})
out['metrik'] = ms
# form
now = datetime(2026, 11, 20, 12, 0).timestamp()
tours = []
for i in range(8):
    tours.append({'sport': 'hike', 'start_ts': now - (10 + 20 * i) * 86400, 'dist_m': 8000 + 1500 * i, 'dur_s': 9000 + 1800 * i, 'up_m': 300 + 100 * i})
tours.append({'sport': 'bike', 'start_ts': now - 5 * 86400, 'dist_m': 50000, 'dur_s': 9000, 'up_m': 400})
tours.append({'sport': 'hike', 'start_ts': now - 400 * 86400, 'dist_m': 30000, 'dur_s': 30000, 'up_m': 900})   # zu alt
tours.append({'sport': 'mountaineering', 'start_ts': now - 40 * 86400, 'dist_m': 12000, 'dur_s': 20000, 'up_m': None})
out['form_tours'] = tours
out['form'] = [{'in': [km, up, est, sp], 'out': p.form(km, up, est, sp, tours, now)} for km, up, est, sp in [(14, 600, 5.0, 'hike'), (30, 1500, 9.0, 'hike'), (9, 250, 2.5, 'mountaineering'), (10, None, None, 'hike'), (20, 500, 3, 'bike')]]
out['form_now'] = now
# fitness
heute = date(2026, 11, 20)
def mk(daysago, dauer, up, hist=None):
    return {'tag': heute - timedelta(days=daysago), 'dauer_s': dauer, 'up_m': up, 'hist': hist}
cases_f = {}
t1 = [mk(d, 7200, 500) for d in (1, 5, 9, 15, 22, 30, 41, 50, 60, 70, 80, 83)] + [mk(d, 5400, 300) for d in (90, 100, 120, 140)]
cases_f['aufstieg'] = (t1, 1976)
hist = {120: 1500, 135: 1800, 150: 600, 100: 400, 170: 300}
t2 = [mk(d, 7200, 500, hist if d in (1, 9, 30) else None) for d in (1, 5, 9, 15, 22, 30, 41, 50)]
cases_f['puls'] = (t2, 1976)
cases_f['jung'] = (t1, 2000)
cases_f['alt'] = (t1, 1945)
cases_f['wenig'] = ([mk(3, 3000, None)], 1980)
cases_f['zu_wenig'] = ([mk(3, None, None), mk(10, None, 200)], 1980)
cases_f['keine'] = ([mk(200, 3000, 100)], 1980)
cases_f['trend_runter'] = ([mk(d, 7200, 500) for d in (1, 3)] + [mk(d, 7200, 500) for d in range(85, 160, 7)], 1980)
fo = {}
for k, (ts, gj) in cases_f.items():
    fo[k] = {'in': {'geburtsjahr': gj, 'touren': [{'tag': t['tag'].isoformat(), 'dauer_s': t['dauer_s'], 'up_m': t['up_m'], 'hist': t['hist']} for t in ts]}, 'out': f.berechne(ts, gj, heute)}
out['fitness'] = fo
out['fitness_units'] = {'umfang': [(m, f.teilwert_umfang(m)) for m in (0, 75, 150, 225, 300, 400)], 'regel': [(l, f.teilwert_regel(l)) for l in ([1]*12, [0]*11+[3], [2,0,1,0,0,0,0,0,0,0,0,0], [0]*12)], 'hfmax': [(a, f.hfmax(a)) for a in (20, 49, 80)], 'faktor': [(a, f.faktor_alter(a)) for a in (20, 30, 50, 90)], 'aufstieg': [(args, f.teilwert_aufstieg(*args)) for args in ((1200, 7200, 40), (300, 3000, 40), (900, 7200, 80), (None, 7200, 40))]}
# Rückblick einordnen (Werte)
rows = [{'dist_m': 8000 + 1000 * i, 'dur_s': 7200 + 900 * i, 'up_m': 300 + 50 * i} for i in range(6)]
cur = r._werte({'dist_m': 14000, 'dur_s': 14000, 'up_m': 900})
out['rueckblick'] = {'rows': rows, 'cur_in': {'dist_m': 14000, 'dur_s': 14000, 'up_m': 900}, 'cur': cur, 'out': r.einordnen(cur, rows)}
# Links
links = []
for u in ['https://www.komoot.de/tour/123', 'http://example.org/a?b=c#d', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'ftp://x.org/f', 'https://user:pw@example.org/', 'https:///nohost', 'https://exa mple.org', '', '  https://example.org/x  ', 'HTTPS://EXAMPLE.ORG', 'https://' + 'a' * 500 + '.de', '//example.org', 'example.org', 'https://example.org/ä']:
    try: links.append({'in': u, 'out': p.pruefe_url(u)})
    except ValueError as e: links.append({'in': u, 'err': str(e)})
out['links'] = links
json.dump(out, open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'calc-erwartet.json'), 'w'), default=str, ensure_ascii=False, indent=1)
print('ok')
