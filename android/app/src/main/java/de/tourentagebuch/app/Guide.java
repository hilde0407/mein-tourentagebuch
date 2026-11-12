package de.tourentagebuch.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Wegführung entlang einer geplanten Strecke: erkennt die Abbiegestellen aus der Geometrie und liefert die Ansagen
 * („In 100 Metern links abbiegen“, „Du bist vom Weg abgekommen“ …). Reine Rechenlogik ohne Android-Bezug, damit sie sich testen lässt.
 */
public final class Guide {
    public static final class Turn {
        public final double at;      // Meter ab Start der Strecke
        public final double angle;   // Grad, > 0 = rechts, < 0 = links
        final double tx, ty;         // Lage der Abbiegung (lokale Meter)
        Turn(double at, double angle, double tx, double ty) { this.at = at; this.angle = angle; this.tx = tx; this.ty = ty; }
    }

    private static final double OFF_M = 40, BACK_M = 30, LOOK_M = 40, MIN_ANGLE = 30, JUNC_M = 30;

    private final double[] la, lo, cum;      // vereinfachte Strecke, Länge ab Start
    private final double[] x, y;             // lokale Koordinaten in Metern
    private final double lat0, kx;
    private final List<Turn> all = new ArrayList<>();      // alle Richtungswechsel
    private List<Turn> turns = new ArrayList<>();               // davon angesagte (an Kreuzungen)
    private double[] jx = null, jy = null;                      // Kreuzungen (lokale Meter), null = unbekannt
    private int[] level;               // je Abbiegung: 0 nichts gesagt, 1 Vorankündigung, 2 „jetzt“

    private double prog = 0;
    private boolean reached = false, introSaid = false, off = false, finished = false, km1 = false;
    private int offCount = 0;
    private long lastOffSay = 0;

    public Guide(double[] lats, double[] lons) {
        int n = lats.length;
        lat0 = n > 0 ? lats[0] : 0;
        kx = Math.cos(Math.toRadians(lat0));
        double[] px = new double[n], py = new double[n];
        for (int i = 0; i < n; i++) { px[i] = (lons[i] - (n > 0 ? lons[0] : 0)) * 111320.0 * kx; py[i] = (lats[i] - lat0) * 110540.0; }
        boolean[] keep = new boolean[n];
        if (n > 0) { keep[0] = true; keep[n - 1] = true; }
        simplify(px, py, 0, n - 1, 6.0, keep);
        int m = 0;
        for (int i = 0; i < n; i++) if (keep[i]) m++;
        la = new double[m]; lo = new double[m]; x = new double[m]; y = new double[m]; cum = new double[m];
        int j = 0;
        for (int i = 0; i < n; i++) {
            if (!keep[i]) continue;
            la[j] = lats[i]; lo[j] = lons[i]; x[j] = px[i]; y[j] = py[i];
            cum[j] = j == 0 ? 0 : cum[j - 1] + Math.hypot(x[j] - x[j - 1], y[j] - y[j - 1]);
            j++;
        }
        findTurns();
        applyFilter();
    }

    /**
     * Ein Richtungswechsel wird nur angesagt, wenn es dort auch etwas zu entscheiden gibt: an einer Wegkreuzung/Gabelung,
     * oder wenn er sehr scharf ist (Kehre). Kennt die App die Kreuzungen nicht (kein Internet), werden nur deutliche Abbiegungen (ab 60°) angesagt.
     */
    private void applyFilter() {
        List<Turn> k = new ArrayList<>();
        for (Turn t : all) {
            double a = Math.abs(t.angle);
            boolean keep;
            if (a >= 120) keep = true;
            else if (jx != null) {
                keep = false;
                for (int i = 0; i < jx.length && !keep; i++) keep = Math.hypot(jx[i] - t.tx, jy[i] - t.ty) <= JUNC_M;
            } else keep = a >= 60;
            if (keep) k.add(t);
        }
        turns = k;
        level = new int[turns.size()];
    }

    /** Kreuzungen setzen: {Breiten, Längen}. */
    public synchronized void setJunctions(double[][] ll) {
        int n = ll[0].length;
        jx = new double[n]; jy = new double[n];
        for (int i = 0; i < n; i++) { jx[i] = (ll[1][i] - lo[0]) * 111320.0 * kx; jy[i] = (ll[0][i] - la[0]) * 110540.0; }
        applyFilter();
    }

    public boolean hasJunctions() { return jx != null; }

    /** Douglas-Peucker, ohne Rekursion. */
    private static void simplify(double[] px, double[] py, int a, int b, double eps, boolean[] keep) {
        if (b - a < 2) return;
        java.util.ArrayDeque<int[]> st = new java.util.ArrayDeque<>();
        st.push(new int[]{a, b});
        while (!st.isEmpty()) {
            int[] s = st.pop();
            int i0 = s[0], i1 = s[1];
            double best = -1;
            int bi = -1;
            for (int i = i0 + 1; i < i1; i++) {
                double d = segDist(px[i], py[i], px[i0], py[i0], px[i1], py[i1], null);
                if (d > best) { best = d; bi = i; }
            }
            if (best > eps && bi > 0) {
                keep[bi] = true;
                st.push(new int[]{i0, bi});
                st.push(new int[]{bi, i1});
            }
        }
    }

    private static double segDist(double px, double py, double ax, double ay, double bx, double by, double[] t) {
        double dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        double u = l2 == 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
        u = Math.max(0, Math.min(1, u));
        if (t != null) t[0] = u;
        return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
    }

    private static double bearing(double ax, double ay, double bx, double by) {
        return Math.toDegrees(Math.atan2(bx - ax, by - ay));
    }

    private static double norm(double a) {
        while (a > 180) a -= 360;
        while (a <= -180) a += 360;
        return a;
    }

    /** Punkt, der ≥ dist Meter vor (dir<0) bzw. hinter (dir>0) Index i liegt (am Rand: der Randpunkt). */
    private int away(int i, int dir) {
        int k = i;
        while (k + dir >= 0 && k + dir < x.length) {
            k += dir;
            if (Math.abs(cum[k] - cum[i]) >= LOOK_M) break;
        }
        return k;
    }

    private void findTurns() {
        int n = x.length;
        if (n < 3) return;
        double[] local = new double[n];
        for (int i = 1; i < n - 1; i++) local[i] = norm(bearing(x[i], y[i], x[i + 1], y[i + 1]) - bearing(x[i - 1], y[i - 1], x[i], y[i]));
        int i = 1;
        while (i < n - 1) {
            if (Math.abs(local[i]) < 16) { i++; continue; }
            int s = i, e = i;                                  // zusammenhängende Kurve: Abstand der Knicke höchstens 30 m, Länge höchstens 100 m
            while (e + 1 < n - 1 && Math.abs(local[e + 1]) >= 16 && cum[e + 1] - cum[e] <= 30 && cum[e + 1] - cum[s] <= 100) e++;
            int b = away(s, -1), f = away(e, 1);
            double in = bearing(x[b], y[b], x[s], y[s]), out = bearing(x[e], y[e], x[f], y[f]);
            double ang = norm(out - in);
            if (Math.abs(ang) >= MIN_ANGLE) {
                int mid = s;
                for (int k = s; k <= e; k++) if (Math.abs(local[k]) > Math.abs(local[mid])) mid = k;
                all.add(new Turn(cum[mid], ang, x[mid], y[mid]));
            }
            i = e + 1;
        }
    }

    /** Vereinfachte Strecke als „[[lat,lon],…]“ für die Kartenanzeige. */
    public String pointsJson() {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < la.length; i++) b.append(i > 0 ? "," : "").append('[').append(String.format(Locale.US, "%.6f,%.6f", la[i], lo[i])).append(']');
        return b.append(']').toString();
    }

    public double totalM() { return x.length == 0 ? 0 : cum[cum.length - 1]; }
    public int turnCount() { return turns.size(); }
    public Turn turn(int i) { return turns.get(i); }
    public double progressM() { return prog; }
    public boolean offRoute() { return off; }

    /** Abstand zur Strecke und Position darauf (Meter ab Start) für die Segmente [from,to]. */
    private double[] nearest(double px, double py, int from, int to, double penaltyFrom) {
        double best = 1e12, bp = prog, bscore = 1e12;
        double[] t = new double[1];
        for (int i = Math.max(0, from); i < Math.min(to, x.length - 1); i++) {
            double d = segDist(px, py, x[i], y[i], x[i + 1], y[i + 1], t);
            double p = cum[i] + t[0] * (cum[i + 1] - cum[i]);
            double score = d + Math.abs(p - penaltyFrom) * 0.01;
            if (score < bscore) { bscore = score; best = d; bp = p; }
        }
        return new double[]{best, bp};
    }

    private int segAt(double along) {
        int lo2 = 0, hi = cum.length - 1;
        while (lo2 < hi) {
            int mid = (lo2 + hi) >>> 1;
            if (cum[mid] <= along) lo2 = mid + 1; else hi = mid;
        }
        return Math.max(0, lo2 - 1);
    }

    private static String dist(double m) {
        if (m >= 950) {
            double km = Math.round(m / 100.0) / 10.0;
            return String.format(Locale.GERMANY, "%s Kilometer", km == Math.rint(km) ? String.valueOf((long) km) : String.format(Locale.GERMANY, "%.1f", km));
        }
        long r = m < 100 ? Math.max(10, Math.round(m / 10.0) * 10) : Math.round(m / 50.0) * 50;
        return r + " Metern";
    }

    private static String distNom(double m) {
        return dist(m).replace("Metern", "Meter");
    }

    static String instruction(double angle) {
        double a = Math.abs(angle);
        String side = angle > 0 ? "rechts" : "links";
        if (a >= 150) return "Kehre nach " + side;
        if (a >= 120) return "scharf " + side + " abbiegen";
        if (a >= 65) return side + " abbiegen";
        return "leicht " + side + " halten";
    }

    private static String cap(String s) { return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1); }

    /**
     * Neue GPS-Position verarbeiten.
     * @param acc Genauigkeit in Metern (0 = unbekannt), @param speed Geschwindigkeit in m/s, @param now Zeit in ms
     * @return Ansagen, die jetzt zu sprechen sind (meist keine)
     */
    public List<String> fix(double lat, double lon, float acc, double speed, long now) {
        List<String> say = new ArrayList<>();
        if (x.length < 2) return say;
        double px = (lon - lo[0]) * 111320.0 * kx, py = (lat - la[0]) * 110540.0;
        double tol = Math.max(OFF_M, acc * 2);
        if (!reached) {
            double[] n = nearest(px, py, 0, x.length - 1, 0);
            if (n[0] <= Math.max(BACK_M, acc)) {
                reached = true;
                prog = n[1];
                say.add(introSaid ? "Du bist auf der Route." : "Du bist auf der Route. Sie ist " + distNom(totalM()) + " lang.");
                introSaid = true;
            } else if (!introSaid) {
                introSaid = true;
                say.add("Die Route ist " + distNom(n[0]) + " entfernt. Geh zur Route, dann beginnt die Führung.");
            }
            return say;
        }
        int seg = segAt(prog);
        double[] n = off ? nearest(px, py, 0, x.length - 1, prog) : nearest(px, py, seg - 6, segAt(prog + 300) + 2, prog);
        if (n[0] > tol) {
            if (!off && ++offCount >= 2) {
                off = true;
                lastOffSay = now;
                double[] g = nearest(px, py, 0, x.length - 1, prog);
                say.add("Du bist vom Weg abgekommen. Bis zur Route sind es " + distNom(g[0]) + ".");
            } else if (off && now - lastOffSay > 90000) {
                lastOffSay = now;
                double[] g = nearest(px, py, 0, x.length - 1, prog);
                say.add("Noch nicht auf der Route, " + distNom(g[0]) + " entfernt.");
            }
            return say;
        }
        offCount = 0;
        if (off) {
            if (n[0] > BACK_M) return say;
            off = false;
            if (n[1] < prog) for (int i = 0; i < level.length; i++) if (turns.get(i).at > n[1]) level[i] = 0;
            say.add("Wieder auf dem Weg.");
        }
        if (n[1] >= prog - 30) prog = Math.max(prog, n[1]);
        double rest = totalM() - prog;
        // nächste Abbiegung
        int ti = -1;
        for (int i = 0; i < turns.size(); i++) if (turns.get(i).at > prog - 8 && level[i] < 2) { ti = i; break; }
        if (ti >= 0) {
            Turn t = turns.get(ti);
            double d = t.at - prog;
            double far = Math.max(45, Math.min(200, speed * 18)), near = Math.max(15, speed * 3.5);   // zu Fuß ca. 50 m vorher, mit dem Rad entsprechend früher
            String then = "";
            if (ti + 1 < turns.size() && turns.get(ti + 1).at - t.at < 40) then = ", danach " + instruction(turns.get(ti + 1).angle);
            if (d <= near && level[ti] < 2) {
                level[ti] = 2;
                say.add(cap("jetzt " + instruction(t.angle)) + then + ".");
            } else if (d <= far && level[ti] < 1 && d > near + 15) {
                level[ti] = 1;
                say.add("In " + dist(d) + " " + instruction(t.angle) + then + ".");
            }
        }
        if (!km1 && rest <= 1000 && totalM() > 2500) {
            km1 = true;
            say.add("Noch ein Kilometer bis zum Ziel.");
        }
        if (!finished && rest <= 25 && prog >= totalM() * 0.8) {
            finished = true;
            say.add("Du hast das Ziel erreicht.");
        }
        return say;
    }

    /** „la,lo;la,lo;…“ → Strecke (ungültige Teile werden übersprungen); null bei weniger als 2 Punkten. */
    public static Guide parse(String s) {
        if (s == null) return null;
        String[] parts = s.split(";");
        double[] a = new double[parts.length], b = new double[parts.length];
        int n = 0;
        for (String p : parts) {
            String[] q = p.trim().split(",");
            if (q.length < 2) continue;
            try {
                double u = Double.parseDouble(q[0]), v = Double.parseDouble(q[1]);
                if (u < -90 || u > 90 || v < -180 || v > 180) continue;
                a[n] = u; b[n] = v; n++;
            } catch (NumberFormatException e) { /* überspringen */ }
        }
        if (n < 2) return null;
        return new Guide(java.util.Arrays.copyOf(a, n), java.util.Arrays.copyOf(b, n));
    }
}
