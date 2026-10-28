/*
 * Bauteil-Explorer – Engine
 * Benötigt three.js r128 als globales THREE (lib/three.min.js) und window.EXPLORER (bauteile.js).
 *
 * Koordinaten der Bauteilbeschreibung (Technik-Koordinaten, alle Maße in mm):
 *   x = nach rechts  (Breite in der Vorderansicht)
 *   y = nach hinten  (Tiefe, vom Betrachter weg)
 *   z = nach oben    (Höhe)
 * Die CSG-Funktionen folgen dem BSP-Verfahren von csg.js (Evan Wallace, MIT-Lizenz).
 */
(function () {
  'use strict';

  const SEG = 64;                       // Segmente pro Vollkreis
  const EPS = 1e-5;                     // CSG-Toleranz in mm
  const TAU = Math.PI * 2;
  const KANTEN_WINKEL = 10 * Math.PI / 180;  // ab diesem Knick wird eine Kante gezeichnet
  const COS_KANTE = Math.cos(KANTEN_WINKEL);
  const DURCH = 5000;                   // Länge von Durchgangsbohrungen
  const UEBERSTAND = 1;                 // Werkzeug beginnt 1 mm vor der Oberfläche
  const ML_UEBERSTAND = 3;              // Mittellinien ragen 3 mm über die Kontur

  const KERNLOCH = {
    M2: 1.6, 'M2.5': 2.05, M3: 2.5, M4: 3.3, M5: 4.2, M6: 5.0, M8: 6.8, M10: 8.5,
    M12: 10.2, M14: 12.0, M16: 14.0, M20: 17.5, M24: 21.0,
  };

  // ------------------------------------------------------------------ Vektor
  class V {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    clone() { return new V(this.x, this.y, this.z); }
    neg() { return new V(-this.x, -this.y, -this.z); }
    add(a) { return new V(this.x + a.x, this.y + a.y, this.z + a.z); }
    sub(a) { return new V(this.x - a.x, this.y - a.y, this.z - a.z); }
    mul(k) { return new V(this.x * k, this.y * k, this.z * k); }
    dot(a) { return this.x * a.x + this.y * a.y + this.z * a.z; }
    cross(a) { return new V(this.y * a.z - this.z * a.y, this.z * a.x - this.x * a.z, this.x * a.y - this.y * a.x); }
    len() { return Math.sqrt(this.dot(this)); }
    unit() { const l = this.len(); return l > 0 ? this.mul(1 / l) : this.clone(); }
    lerp(a, t) { return new V(this.x + (a.x - this.x) * t, this.y + (a.y - this.y) * t, this.z + (a.z - this.z) * t); }
  }
  const vec = (a) => new V(a[0], a[1], a[2]);

  // ------------------------------------------------------------------ CSG (BSP)
  class Vert {
    constructor(pos, normal) { this.pos = pos; this.normal = normal; }
    clone() { return new Vert(this.pos, this.normal); }
    flip() { this.normal = this.normal.neg(); }
    interpolate(o, t) { return new Vert(this.pos.lerp(o.pos, t), this.normal.lerp(o.normal, t)); }
  }

  class Plane {
    constructor(normal, w) { this.normal = normal; this.w = w; }
    static fromPoints(a, b, c) { const n = b.sub(a).cross(c.sub(a)).unit(); return new Plane(n, n.dot(a)); }
    clone() { return new Plane(this.normal, this.w); }
    flip() { this.normal = this.normal.neg(); this.w = -this.w; }
    split(poly, cf, cb, f, b) {
      let ptype = 0;
      const types = [];
      for (const v of poly.vertices) {
        const t = this.normal.dot(v.pos) - this.w;
        const ty = t < -EPS ? 2 : t > EPS ? 1 : 0;
        ptype |= ty;
        types.push(ty);
      }
      if (ptype === 0) (this.normal.dot(poly.plane.normal) > 0 ? cf : cb).push(poly);
      else if (ptype === 1) f.push(poly);
      else if (ptype === 2) b.push(poly);
      else {
        const fv = [], bv = [], vs = poly.vertices, n = vs.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, ti = types[i], tj = types[j], vi = vs[i], vj = vs[j];
          if (ti !== 2) fv.push(vi);
          if (ti !== 1) bv.push(ti !== 2 ? vi.clone() : vi);
          if ((ti | tj) === 3) {
            const t = (this.w - this.normal.dot(vi.pos)) / this.normal.dot(vj.pos.sub(vi.pos));
            const v = vi.interpolate(vj, t);
            fv.push(v);
            bv.push(v.clone());
          }
        }
        if (fv.length >= 3) f.push(new Poly(fv, poly.plane.clone()));
        if (bv.length >= 3) b.push(new Poly(bv, poly.plane.clone()));
      }
    }
  }

  class Poly {
    constructor(vertices, plane) {
      this.vertices = vertices;
      this.plane = plane || Plane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
    }
    flip() { this.vertices.reverse(); for (const v of this.vertices) v.flip(); this.plane.flip(); }
  }

  // Iterativ statt rekursiv, damit große Bauteile keinen Stack-Überlauf erzeugen.
  class Node {
    constructor(polys) { this.plane = null; this.front = null; this.back = null; this.polygons = []; if (polys) this.build(polys); }
    nodes() {
      const out = [], st = [this];
      while (st.length) { const n = st.pop(); out.push(n); if (n.front) st.push(n.front); if (n.back) st.push(n.back); }
      return out;
    }
    invert() {
      for (const n of this.nodes()) {
        for (const p of n.polygons) p.flip();
        if (n.plane) n.plane.flip();
        const t = n.front; n.front = n.back; n.back = t;
      }
    }
    clipPolygons(polys) {
      if (!this.plane) return polys.slice();
      const out = [], st = [[this, polys]];
      while (st.length) {
        const [n, ps] = st.pop();
        const f = [], b = [];
        for (const p of ps) n.plane.split(p, f, b, f, b);
        if (f.length) { if (n.front) st.push([n.front, f]); else for (const p of f) out.push(p); }
        if (b.length && n.back) st.push([n.back, b]);
      }
      return out;
    }
    clipTo(bsp) { for (const n of this.nodes()) n.polygons = bsp.clipPolygons(n.polygons); }
    allPolygons() { const out = []; for (const n of this.nodes()) for (const p of n.polygons) out.push(p); return out; }
    build(polys) {
      const st = [[this, polys]];
      while (st.length) {
        const [n, ps] = st.pop();
        if (!ps.length) continue;
        if (!n.plane) n.plane = ps[0].plane.clone();
        const f = [], b = [];
        for (const p of ps) n.plane.split(p, n.polygons, n.polygons, f, b);
        if (f.length) { if (!n.front) n.front = new Node(); st.push([n.front, f]); }
        if (b.length) { if (!n.back) n.back = new Node(); st.push([n.back, b]); }
      }
    }
  }

  function csgUnion(a, b) {
    const A = new Node(a), B = new Node(b);
    A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
    A.build(B.allPolygons());
    return A.allPolygons();
  }

  function csgSubtract(a, b) {
    const A = new Node(a), B = new Node(b);
    A.invert(); A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
    A.build(B.allPolygons()); A.invert();
    return A.allPolygons();
  }

  // ------------------------------------------------------------------ Dreiecks-Bausteine
  // Ein Dreieck ist [a, b, c, na, nb, nc]. Die Umlaufrichtung wird an der gewünschten
  // Flächennormale ausgerichtet, damit die Generatoren sich nicht darum kümmern müssen.
  function addTri(out, a, b, c, na, nb, nc, nFace) {
    const g = b.sub(a).cross(c.sub(a));
    if (g.len() < 1e-10) return;
    if (g.dot(nFace) < 0) out.push([a, c, b, na, nc, nb]);
    else out.push([a, b, c, na, nb, nc]);
  }
  function addQuad(out, p0, p1, p2, p3, n0, n1, n2, n3, nFace) {
    addTri(out, p0, p1, p2, n0, n1, n2, nFace);
    addTri(out, p0, p2, p3, n0, n2, n3, nFace);
  }

  function trisToPolys(tris) {
    return tris.map(t => new Poly([new Vert(t[0], t[3]), new Vert(t[1], t[4]), new Vert(t[2], t[5])]));
  }

  function boxOfPoints(pts) {
    const b = { min: new V(Infinity, Infinity, Infinity), max: new V(-Infinity, -Infinity, -Infinity) };
    for (const p of pts) {
      if (p.x < b.min.x) b.min.x = p.x; if (p.y < b.min.y) b.min.y = p.y; if (p.z < b.min.z) b.min.z = p.z;
      if (p.x > b.max.x) b.max.x = p.x; if (p.y > b.max.y) b.max.y = p.y; if (p.z > b.max.z) b.max.z = p.z;
    }
    return b;
  }
  const boxOfTris = (tris) => boxOfPoints(tris.flatMap(t => [t[0], t[1], t[2]]));
  const boxOfPolys = (ps) => boxOfPoints(ps.flatMap(p => p.vertices.map(v => v.pos)));
  function boxesOverlap(a, b) {
    const e = 1e-6;
    return a.min.x <= b.max.x + e && b.min.x <= a.max.x + e &&
           a.min.y <= b.max.y + e && b.min.y <= a.max.y + e &&
           a.min.z <= b.max.z + e && b.min.z <= a.max.z + e;
  }
  function mergeBox(a, b) {
    if (!a) return b;
    return boxOfPoints([a.min, a.max, b.min, b.max]);
  }

  // ------------------------------------------------------------------ 2D-Profile
  // Profilpunkte: [a, b]  |  [a, b, {r: 5}]  (Radius an der Ecke)  |  [a, b, {fase: 2}]  oder {fase: [2, 3]}
  //               {mitte: [a, b], bis: [a, b], cw: true}  (Kreisbogen vom vorigen Punkt bis 'bis')
  function profilPunkte(items) {
    const nodes = items.map(it => Array.isArray(it) ? { p: [it[0], it[1]], o: it[2] || {} } : { arc: it });
    const n = nodes.length;
    const endOf = (k) => { const nd = nodes[((k % n) + n) % n]; return nd.arc ? nd.arc.bis : nd.p; };
    const out = [];
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      if (nd.arc) {
        const S = endOf(i - 1), C = nd.arc.mitte, E = nd.arc.bis;
        const r = Math.hypot(S[0] - C[0], S[1] - C[1]);
        const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]), a1 = Math.atan2(E[1] - C[1], E[0] - C[0]);
        let sweep = nd.arc.cw ? a0 - a1 : a1 - a0;
        while (sweep <= 1e-9) sweep += TAU;
        while (sweep > TAU + 1e-9) sweep -= TAU;
        const sg = nd.arc.cw ? -1 : 1;
        const steps = Math.max(1, Math.ceil(sweep / (TAU / SEG) - 1e-9));
        for (let k = 1; k <= steps; k++) {
          if (k === steps) out.push([E[0], E[1]]);
          else { const a = a0 + sg * sweep * k / steps; out.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
        }
        continue;
      }
      const P = nd.p, o = nd.o, next = nodes[(i + 1) % n];
      if ((o.r || o.fase) && !next.arc) {
        const A = endOf(i - 1), B = next.p;
        let u1 = [A[0] - P[0], A[1] - P[1]], u2 = [B[0] - P[0], B[1] - P[1]];
        const l1 = Math.hypot(u1[0], u1[1]), l2 = Math.hypot(u2[0], u2[1]);
        u1 = [u1[0] / l1, u1[1] / l1]; u2 = [u2[0] / l2, u2[1] / l2];
        if (o.fase) {
          const f = Array.isArray(o.fase) ? o.fase : [o.fase, o.fase];
          out.push([P[0] + u1[0] * f[0], P[1] + u1[1] * f[0]]);
          out.push([P[0] + u2[0] * f[1], P[1] + u2[1] * f[1]]);
        } else {
          const cosPhi = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
          const alpha = Math.acos(cosPhi) / 2;
          if (alpha < 1e-6 || alpha > Math.PI / 2 - 1e-6) { out.push(P); continue; }
          const t = o.r / Math.tan(alpha);
          const T1 = [P[0] + u1[0] * t, P[1] + u1[1] * t], T2 = [P[0] + u2[0] * t, P[1] + u2[1] * t];
          let bis = [u1[0] + u2[0], u1[1] + u2[1]];
          const bl = Math.hypot(bis[0], bis[1]); bis = [bis[0] / bl, bis[1] / bl];
          const d = o.r / Math.sin(alpha);
          const C = [P[0] + bis[0] * d, P[1] + bis[1] * d];
          const b0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), b1 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
          let sw = b1 - b0;
          while (sw > Math.PI) sw -= TAU;
          while (sw < -Math.PI) sw += TAU;
          const steps = Math.max(1, Math.ceil(Math.abs(sw) / (TAU / SEG) - 1e-9));
          out.push(T1);
          for (let k = 1; k <= steps; k++) {
            if (k === steps) out.push(T2);
            else { const a = b0 + sw * k / steps; out.push([C[0] + o.r * Math.cos(a), C[1] + o.r * Math.sin(a)]); }
          }
        }
        continue;
      }
      out.push(P);
    }
    // doppelte Punkte entfernen
    const clean = [];
    for (const p of out) {
      const q = clean[clean.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) clean.push(p);
    }
    while (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 1e-9) clean.pop();
    return clean;
  }

  function ccw(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a < 0 ? pts.slice().reverse() : pts;
  }

  // Normalen einer geschlossenen CCW-Kontur. An flachen Knicken (< KANTEN_WINKEL) werden sie gemittelt,
  // damit Rundungen weich schattiert werden.
  function konturNormalen(pts) {
    const n = pts.length, en = [], start = [], end = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
      en.push([dy / L, -dx / L]);
    }
    for (let i = 0; i < n; i++) {
      const ip = (i - 1 + n) % n, prev = en[ip], cur = en[i];
      if (prev[0] * cur[0] + prev[1] * cur[1] > COS_KANTE) {
        let m = [prev[0] + cur[0], prev[1] + cur[1]];
        const l = Math.hypot(m[0], m[1]); m = [m[0] / l, m[1] / l];
        start[i] = m; end[ip] = m;
      } else { start[i] = cur; end[ip] = prev; }
    }
    return { en, start, end };
  }

  // ------------------------------------------------------------------ Körper-Generatoren
  function achse(spec) {
    const m = { x: [1, 0, 0], '-x': [-1, 0, 0], y: [0, 1, 0], '-y': [0, -1, 0], z: [0, 0, 1], '-z': [0, 0, -1] };
    const raw = Array.isArray(spec) ? spec : m[spec || 'z'];
    if (!raw) throw new Error('Unbekannte Achse/Richtung: ' + spec);
    const a = vec(raw).unit();
    let e1 = Math.abs(a.z) > 0.9 ? new V(1, 0, 0) : Math.abs(a.x) > 0.9 ? new V(0, 1, 0) : new V(0, 0, 1);
    e1 = e1.sub(a.mul(e1.dot(a))).unit();
    return { a, e1, e2: a.cross(e1) };
  }

  // Rotationskörper: Kontur in (r, h), um die Achse a durch 'base' gedreht.
  function revolve(kontur, base, ax) {
    const pts = ccw(kontur), { en, start, end } = konturNormalen(pts), out = [];
    const R = [];
    for (let k = 0; k <= SEG; k++) {
      const t = TAU * (k % SEG) / SEG;
      R.push(ax.e1.mul(Math.cos(t)).add(ax.e2.mul(Math.sin(t))));
    }
    const P = (pt, r) => base.add(r.mul(pt[0])).add(ax.a.mul(pt[1]));
    const N = (nn, r) => r.mul(nn[0]).add(ax.a.mul(nn[1])).unit();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (p[0] < 1e-9 && q[0] < 1e-9) continue;
      for (let k = 0; k < SEG; k++) {
        const r0 = R[k], r1 = R[k + 1], rm = r0.add(r1).unit();
        addQuad(out, P(p, r0), P(q, r0), P(q, r1), P(p, r1),
          N(start[i], r0), N(end[i], r0), N(end[i], r1), N(start[i], r1), N(en[i], rm));
      }
    }
    return out;
  }

  const EBENEN = {
    xz: { p: (a, b, w) => new V(a, w, b), W: new V(0, 1, 0) },   // Profil der Vorderansicht, Tiefe in y
    xy: { p: (a, b, w) => new V(a, b, w), W: new V(0, 0, 1) },   // Profil der Draufsicht, Höhe in z
    yz: { p: (a, b, w) => new V(w, a, b), W: new V(1, 0, 0) },   // Profil der Seitenansicht, Breite in x
  };

  // Prisma: ebene Kontur, senkrecht zur Ebene von w0 bis w1 extrudiert.
  function prisma(kontur, ebene, w0, w1) {
    const E = EBENEN[ebene];
    if (!E) throw new Error('Unbekannte Ebene: ' + ebene + " (erlaubt: 'xz', 'xy', 'yz')");
    if (w1 < w0) [w0, w1] = [w1, w0];
    const pts = ccw(kontur), { en, start, end } = konturNormalen(pts), out = [];
    const nv = (n2) => E.p(n2[0], n2[1], 0);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      addQuad(out, E.p(p[0], p[1], w0), E.p(q[0], q[1], w0), E.p(q[0], q[1], w1), E.p(p[0], p[1], w1),
        nv(start[i]), nv(end[i]), nv(end[i]), nv(start[i]), nv(en[i]));
    }
    const faces = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
    const Wn = E.W.neg();
    for (const [i, j, k] of faces) {
      addTri(out, E.p(pts[i][0], pts[i][1], w0), E.p(pts[j][0], pts[j][1], w0), E.p(pts[k][0], pts[k][1], w0), Wn, Wn, Wn, Wn);
      addTri(out, E.p(pts[i][0], pts[i][1], w1), E.p(pts[j][0], pts[j][1], w1), E.p(pts[k][0], pts[k][1], w1), E.W, E.W, E.W, E.W);
    }
    return out;
  }

  // ------------------------------------------------------------------ Elemente
  function istMinus(el) { return el.typ === 'bohrung' || el.op === 'minus' || el.minus === true; }

  function baueElement(el) {
    const res = { tris: [], achsen: [], kosmetik: [] };
    const zahl = (v, name) => { if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${el.typ}: '${name}' fehlt oder ist keine Zahl`); return v; };
    const rot = (kontur, ax, base, hMin, hMax, rMax) => {
      res.tris = revolve(kontur, base, ax);
      if (el.mittellinie !== false) res.achsen.push({ base, ax, h0: hMin - ML_UEBERSTAND, h1: hMax + ML_UEBERSTAND, kreuzR: rMax + ML_UEBERSTAND, kreuzH: hMin });
    };
    switch (el.typ) {
      case 'quader': {
        const [x, y, z] = el.pos || [0, 0, 0], [lx, ly, lz] = el.mass;
        res.tris = prisma([[x, y], [x + zahl(lx, 'mass'), y], [x + lx, y + zahl(ly, 'mass')], [x, y + ly]], 'xy', z, z + zahl(lz, 'mass'));
        break;
      }
      case 'prisma': {
        res.tris = prisma(profilPunkte(el.profil), el.ebene, zahl(el.von, 'von'), zahl(el.bis, 'bis'));
        break;
      }
      case 'zylinder': {
        const ax = achse(el.achse), r = zahl(el.d, 'd') / 2, h = zahl(el.h, 'h');
        rot([[0, 0], [r, 0], [r, h], [0, h]], ax, vec(el.pos || [0, 0, 0]), 0, h, r);
        break;
      }
      case 'kegelstumpf':
      case 'kegel': {
        const ax = achse(el.achse), r1 = zahl(el.d1, 'd1') / 2, r2 = el.typ === 'kegel' ? 0 : zahl(el.d2, 'd2') / 2, h = zahl(el.h, 'h');
        const k = r2 > 1e-9 ? [[0, 0], [r1, 0], [r2, h], [0, h]] : [[0, 0], [r1, 0], [0, h]];
        rot(k, ax, vec(el.pos || [0, 0, 0]), 0, h, Math.max(r1, r2));
        break;
      }
      case 'drehteil': {
        const ax = achse(el.achse), k = profilPunkte(el.profil);
        const hs = k.map(p => p[1]), rs = k.map(p => p[0]);
        rot(k, ax, vec(el.pos || [0, 0, 0]), Math.min(...hs), Math.max(...hs), Math.max(...rs));
        break;
      }
      case 'bohrung': {
        if (!Array.isArray(el.pos)) throw new Error("'pos' (Punkt auf der Eintrittsfläche) fehlt");
        const ax = achse(el.richtung || '-z'), base = vec(el.pos);
        let d = el.d;
        if (el.gewinde) {
          const kl = KERNLOCH[el.gewinde];
          if (!d) { if (!kl) throw new Error('Unbekanntes Gewinde ' + el.gewinde + ' – bitte d (Kernloch) angeben'); d = kl; }
          const nenn = parseFloat(String(el.gewinde).replace(/^M/i, ''));
          if (nenn) res.kosmetik.push({ base, ax, r: nenn / 2 });
        }
        const R = zahl(d, 'd') / 2;
        const durch = el.tiefe === 'durch';
        const T = durch ? DURCH : zahl(el.tiefe, 'tiefe');
        const spitze = !durch && el.spitze !== false;
        const k = [[0, -UEBERSTAND]];
        let rAussen = R;
        if (el.senkung) {
          const Rs = zahl(el.senkung.d, 'senkung.d') / 2;
          rAussen = Rs;
          if (el.senkung.winkel) {
            const tw = Math.tan(el.senkung.winkel / 2 * Math.PI / 180);
            k.push([Rs + UEBERSTAND * tw, -UEBERSTAND], [Rs, 0], [R, (Rs - R) / tw]);
          } else {
            const ts = zahl(el.senkung.tiefe, 'senkung.tiefe');
            k.push([Rs, -UEBERSTAND], [Rs, ts], [R, ts]);
          }
        } else k.push([R, -UEBERSTAND]);
        k.push([R, T]);
        const tEnde = spitze ? T + R / Math.tan(59 * Math.PI / 180) : T;
        k.push([0, tEnde]);
        res.tris = revolve(k, base, ax);
        if (el.mittellinie !== false) res.achsen.push({ base, ax, h0: -ML_UEBERSTAND, h1: durch ? null : tEnde + ML_UEBERSTAND, kreuzR: rAussen + ML_UEBERSTAND, kreuzH: 0 });
        break;
      }
      case 'mittellinie': {
        const A = vec(el.von), B = vec(el.bis);
        res.linien = [[A, B]];
        break;
      }
      default:
        throw new Error('Unbekannter Elementtyp: ' + el.typ);
    }
    return res;
  }

  // ------------------------------------------------------------------ Bauteil berechnen
  function baueBauteil(def) {
    const t0 = performance.now();
    let polys = null, box = null;
    const achsen = [], kosmetik = [], linien = [];
    const elemente = def.elemente || [];
    if (!elemente.length) throw new Error('Keine Elemente angegeben');

    // aufeinanderfolgende Elemente gleicher Art zu einem Werkzeug zusammenfassen
    const laeufe = [];
    for (let i = 0; i < elemente.length; i++) {
      const el = elemente[i];
      let r;
      try { r = baueElement(el); } catch (e) { throw new Error(`Element ${i + 1} (${el.typ}): ${e.message}`); }
      achsen.push(...r.achsen.map(a => ({ ...a, minus: istMinus(el) })));
      kosmetik.push(...r.kosmetik);
      if (r.linien) { linien.push(...r.linien); continue; }
      if (!r.tris.length) continue;
      const minus = istMinus(el);
      const last = laeufe[laeufe.length - 1];
      const teil = { polys: trisToPolys(r.tris), box: boxOfTris(r.tris) };
      if (last && last.minus === minus) last.teile.push(teil);
      else laeufe.push({ minus, teile: [teil] });
    }

    for (const lauf of laeufe) {
      let wz = null, wzBox = null;
      const boxes = [];
      for (const t of lauf.teile) {
        if (!wz) wz = t.polys;
        else if (boxes.some(b => boxesOverlap(b, t.box))) wz = csgUnion(wz, t.polys);
        else wz = wz.concat(t.polys);
        boxes.push(t.box);
        wzBox = mergeBox(wzBox, t.box);
      }
      if (!lauf.minus) {
        if (!polys) polys = wz;
        else if (boxesOverlap(box, wzBox)) polys = csgUnion(polys, wz);
        else polys = polys.concat(wz);
        box = mergeBox(box, wzBox);
      } else {
        if (!polys) throw new Error('Das erste Element muss ein Grundkörper sein (kein minus / keine Bohrung).');
        if (boxesOverlap(box, wzBox)) polys = csgSubtract(polys, wz);
      }
    }

    // Dreiecke
    const tris = [];
    for (const p of polys) {
      const vs = p.vertices;
      for (let i = 1; i < vs.length - 1; i++) {
        const a = vs[0].pos, b = vs[i].pos, c = vs[i + 1].pos;
        if (b.sub(a).cross(c.sub(a)).len() < 1e-10) continue;
        tris.push([a, b, c, vs[0].normal, vs[i].normal, vs[i + 1].normal]);
      }
    }
    if (!tris.length) throw new Error('Das Ergebnis ist leer – wurde der ganze Körper weggeschnitten?');
    const bb = boxOfTris(tris);

    let vol = 0;
    for (const t of tris) vol += t[0].dot(t[1].cross(t[2])) / 6;

    // Achsen von Durchgangsbohrungen bis zum Austritt aus dem Bauteil verlängern
    for (const a of achsen) {
      if (a.h1 !== null) continue;
      let tExit = Infinity;
      for (const k of ['x', 'y', 'z']) {
        const dk = a.ax.a[k];
        if (Math.abs(dk) < 1e-12) continue;
        const t = ((dk > 0 ? bb.max[k] : bb.min[k]) - a.base[k]) / dk;
        if (t < tExit) tExit = t;
      }
      a.h1 = (isFinite(tExit) ? tExit : 0) + ML_UEBERSTAND;
    }

    const kanten = extrahiereKanten(tris);
    return {
      tris, box: bb, kanten, achsen, kosmetik, linien,
      info: {
        dreiecke: tris.length,
        ms: Math.round(performance.now() - t0),
        volumen_cm3: Math.round(vol / 10) / 100,
        min: [bb.min.x, bb.min.y, bb.min.z].map(r3),
        max: [bb.max.x, bb.max.y, bb.max.z].map(r3),
        abmessungen: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map(r3),
      },
    };
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // ------------------------------------------------------------------ Kanten
  // Robust gegenüber T-Stößen aus der CSG: alle Dreieckskanten werden nach Trägergeraden gruppiert,
  // jede Gerade in Elementarintervalle zerlegt und pro Intervall werden die angrenzenden Flächen verglichen.
  //   Knick > KANTEN_WINKEL  -> feste Körperkante
  //   flacher Knick          -> Kandidat für Umrisslinien (Silhouetten), abhängig von der Blickrichtung
  function extrahiereKanten(tris) {
    const lines = new Map();
    for (const t of tris) {
      const [a, b, c] = t;
      const nRaw = b.sub(a).cross(c.sub(a)), nl = nRaw.len();
      if (nl < 1e-12) continue;
      const n = nRaw.mul(1 / nl);
      for (const [P, Q] of [[a, b], [b, c], [c, a]]) {
        let d = Q.sub(P);
        const L = d.len();
        if (L < 1e-7) continue;
        d = d.mul(1 / L);
        if (d.x < -1e-9 || (Math.abs(d.x) <= 1e-9 && (d.y < -1e-9 || (Math.abs(d.y) <= 1e-9 && d.z < 0)))) d = d.neg();
        const tP = P.dot(d), tQ = Q.dot(d), p0 = P.sub(d.mul(tP));
        const key = Math.round(d.x * 1e5) + ',' + Math.round(d.y * 1e5) + ',' + Math.round(d.z * 1e5) + ',' +
          Math.round(p0.x * 1e3) + ',' + Math.round(p0.y * 1e3) + ',' + Math.round(p0.z * 1e3);
        let ln = lines.get(key);
        if (!ln) { ln = { d, p0, items: [] }; lines.set(key, ln); }
        ln.items.push(Math.min(tP, tQ), Math.max(tP, tQ), n);
      }
    }
    const fest = [], weich = [];
    const pt = (ln, t) => ln.p0.add(ln.d.mul(t));
    for (const ln of lines.values()) {
      const it = ln.items, m = it.length / 3;
      if (m < 2) continue;
      const ts = [];
      for (let k = 0; k < m; k++) ts.push(it[3 * k], it[3 * k + 1]);
      ts.sort((x, y) => x - y);
      const u = [ts[0]];
      for (const t of ts) if (t - u[u.length - 1] > 1e-6) u.push(t);
      let runA = null, runB = null;
      const flush = () => { if (runA !== null) { const A = pt(ln, runA), B = pt(ln, runB); fest.push(A.x, A.y, A.z, B.x, B.y, B.z); runA = null; } };
      for (let i = 0; i < u.length - 1; i++) {
        const t0 = u[i], t1 = u[i + 1], ns = [];
        for (let k = 0; k < m; k++) if (it[3 * k] <= t0 + 1e-6 && it[3 * k + 1] >= t1 - 1e-6) ns.push(it[3 * k + 2]);
        let cls = 0, n1 = null, n2 = null;
        if (ns.length >= 2) {
          let minDot = 2;
          for (let a = 0; a < ns.length; a++) for (let b = a + 1; b < ns.length; b++) {
            const dd = ns[a].dot(ns[b]);
            if (dd < minDot) { minDot = dd; n1 = ns[a]; n2 = ns[b]; }
          }
          if (minDot < COS_KANTE) cls = 1;
          else if (minDot < 1 - 1e-9) cls = 2;
        }
        if (cls === 1) { if (runA === null) runA = t0; runB = t1; }
        else {
          flush();
          if (cls === 2) {
            const A = pt(ln, t0), B = pt(ln, t1);
            weich.push(A.x, A.y, A.z, B.x, B.y, B.z, n1.x, n1.y, n1.z, n2.x, n2.y, n2.z);
          }
        }
      }
      flush();
    }
    return { fest: new Float32Array(fest), weich: new Float32Array(weich) };
  }

  // Umrisslinien gekrümmter Flächen. Sie werden um 'off' (ca. 1 Pixel) quer zur Blickrichtung nach außen
  // geschoben, sonst verdecken die fast streifend gesehenen Nachbarfacetten die Linie im Tiefentest.
  function silhouetten(weich, v, off) {
    const out = [], s = (d) => d > 1e-6 ? 1 : d < -1e-6 ? -1 : 0;
    for (let i = 0; i < weich.length; i += 12) {
      const d1 = weich[i + 6] * v.x + weich[i + 7] * v.y + weich[i + 8] * v.z;
      const d2 = weich[i + 9] * v.x + weich[i + 10] * v.y + weich[i + 11] * v.z;
      if (s(d1) === s(d2)) continue;
      let nx = weich[i + 6] + weich[i + 9], ny = weich[i + 7] + weich[i + 10], nz = weich[i + 8] + weich[i + 11];
      const dv = nx * v.x + ny * v.y + nz * v.z;
      nx -= v.x * dv; ny -= v.y * dv; nz -= v.z * dv;
      const l = Math.hypot(nx, ny, nz) || 1, k = off / l;
      out.push(weich[i] + nx * k, weich[i + 1] + ny * k, weich[i + 2] + nz * k,
        weich[i + 3] + nx * k, weich[i + 4] + ny * k, weich[i + 5] + nz * k);
    }
    return out;
  }

  // ------------------------------------------------------------------ Mittellinien (Strich-Punkt)
  function mittellinienSegmente(teil) {
    const segs = [];
    for (const a of teil.achsen) {
      segs.push([a.base.add(a.ax.a.mul(a.h0)), a.base.add(a.ax.a.mul(a.h1))]);
      const c = a.base.add(a.ax.a.mul(a.kreuzH));
      segs.push([c.sub(a.ax.e1.mul(a.kreuzR)), c.add(a.ax.e1.mul(a.kreuzR))]);
      segs.push([c.sub(a.ax.e2.mul(a.kreuzR)), c.add(a.ax.e2.mul(a.kreuzR))]);
    }
    for (const l of teil.linien) segs.push(l);
    return segs;
  }

  function strichPunkt(segs, s) {
    const L1 = 14 * s, G = 3 * s, D = 1.5 * s, out = [];
    for (const [A, B] of segs) {
      const dv = B.sub(A), len = dv.len();
      if (len < 1e-9) continue;
      const d = dv.mul(1 / len);
      let t = 0, lang = true;
      while (t < len) {
        const e = Math.min(t + (lang ? L1 : D), len);
        const P = A.add(d.mul(t)), Q = A.add(d.mul(e));
        out.push(P.x, P.y, P.z, Q.x, Q.y, Q.z);
        t = e + G;
        lang = !lang;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ Viewer
  const ANSICHTEN = {
    iso:   { name: 'Isometrische Projektion (30° / 30°, alle Kanten 1:1)', theta: Math.PI / 4, phi: Math.acos(1 / Math.sqrt(3)) },
    // Kabinett: Blick von vorne, Tiefe wird unter 45° mit halber Länge abgebildet (Scherung, kein echter Blickwinkel)
    kabinett: { name: 'Kabinettprojektion (45°, Tiefe halbiert)', theta: 0, phi: Math.PI / 2, scher: 0.5 * Math.SQRT1_2 },
    vorne: { name: 'Vorderansicht', theta: 0, phi: Math.PI / 2 },
    oben:  { name: 'Draufsicht', theta: 0, phi: 0 },
    links: { name: 'Seitenansicht von links', theta: -Math.PI / 2, phi: Math.PI / 2 },
  };

  // Flächenfarben je Normansicht: Flächen, die in der gewählten Ansicht zu sehen sind, werden eingefärbt
  const FARBEN = {
    neutral: 0xd9d2c0,
    vorne: 0x6fa8dc,   // Vorderansicht: blau
    oben:  0x7cc48a,   // Draufsicht: grün
    links: 0xf0a35e,   // Seitenansicht von links: orange
  };
  const BLICKACHSE = { vorne: [0, -1, 0], oben: [0, 0, 1], links: [-1, 0, 0] };   // zum Betrachter hin, Technik-Koordinaten

  function start() {
    const cfg = window.EXPLORER || { bauteile: [] };
    const $ = (id) => document.getElementById(id);
    if (cfg.titel) { $('titel').textContent = cfg.titel; document.title = cfg.titel; }
    if (cfg.untertitel) $('untertitel').textContent = cfg.untertitel;

    const wrap = $('viewerWrap');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    wrap.insertBefore(renderer.domElement, wrap.firstChild);

    const lichter = (scene) => {
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const k = new THREE.DirectionalLight(0xffffff, 0.9); k.position.set(4, 6, 5); scene.add(k);
      const f = new THREE.DirectionalLight(0xffffff, 0.35); f.position.set(-5, -2, -4); scene.add(f);
      const l = new THREE.DirectionalLight(0xffffff, 0.35); l.position.set(-6, 1, 1); scene.add(l);   // Aufhellung von links (Seitenansicht)
    };
    const scene = new THREE.Scene();
    lichter(scene);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;           // Technik (x, y, z) -> three (x, z, -y)
    scene.add(root);
    // Scherung für die Kabinettprojektion (in Technik-Koordinaten): x' = x + c·y, z' = z + c·y
    const scherGruppe = new THREE.Group();
    scherGruppe.matrixAutoUpdate = false;
    root.add(scherGruppe);
    let scher = 0, scherZiel = 0;
    const setzeScher = (c) => {
      scher = c;
      scherGruppe.matrix.set(1, c, 0, 0,  0, 1, 0, 0,  0, c, 1, 0,  0, 0, 0, 1);
      scherGruppe.matrixWorldNeedsUpdate = true;
    };

    const solidMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4,
    });
    const sichtbarMat = new THREE.LineBasicMaterial({ color: 0x262d43, depthWrite: false });
    const verdecktMat = new THREE.LineDashedMaterial({ color: 0x4a5168, dashSize: 1, gapSize: 1, depthWrite: false, depthFunc: THREE.GreaterDepth });
    const mittelMat = new THREE.LineBasicMaterial({ color: 0xb4532a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85 });
    const kosmetikMat = new THREE.LineBasicMaterial({ color: 0x262d43, depthWrite: false, transparent: true, opacity: 0.6 });

    const status = [];
    window.EXPLORER_STATUS = status;
    const teile = [];

    function objekteFuer(t) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(t.tris.length * 9), nor = new Float32Array(t.tris.length * 9);
      t.tris.forEach((tr, i) => {
        for (let k = 0; k < 3; k++) {
          const p = tr[k], n = tr[3 + k];
          pos.set([p.x, p.y, p.z], i * 9 + k * 3);
          nor.set([n.x, n.y, n.z], i * 9 + k * 3);
        }
      });
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      // Flächennormalen je Dreieck (für die Einfärbung nach Ansicht)
      const faceN = t.tris.map(tr => {
        const a = tr[0], b = tr[1], c = tr[2];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        return [nx / l, ny / l, nz / l];
      });
      const colAttr = new THREE.BufferAttribute(new Float32Array(t.tris.length * 9), 3);
      geo.setAttribute('color', colAttr);
      const mesh = new THREE.Mesh(geo, solidMat);
      const kantenGeo = new THREE.BufferGeometry();
      const verdeckt = new THREE.LineSegments(kantenGeo, verdecktMat);
      const sichtbar = new THREE.LineSegments(kantenGeo, sichtbarMat);
      const mittel = new THREE.LineSegments(new THREE.BufferGeometry(), mittelMat);
      const kosmetikGeo = new THREE.BufferGeometry();
      const kp = [];
      for (const k of t.kosmetik) {
        for (let i = 0; i < SEG; i++) {
          const a0 = TAU * i / SEG, a1 = TAU * (i + 1) / SEG;
          const P = k.base.add(k.ax.e1.mul(k.r * Math.cos(a0))).add(k.ax.e2.mul(k.r * Math.sin(a0)));
          const Q = k.base.add(k.ax.e1.mul(k.r * Math.cos(a1))).add(k.ax.e2.mul(k.r * Math.sin(a1)));
          kp.push(P.x, P.y, P.z, Q.x, Q.y, Q.z);
        }
      }
      kosmetikGeo.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
      const kosm = new THREE.LineSegments(kosmetikGeo, kosmetikMat);
      mesh.renderOrder = 0; verdeckt.renderOrder = 1; sichtbar.renderOrder = 2; kosm.renderOrder = 2; mittel.renderOrder = 3;
      const inner = new THREE.Group();
      [mesh, verdeckt, sichtbar, kosm, mittel].forEach(o => { o.frustumCulled = false; inner.add(o); });
      const c = t.box.min.add(t.box.max).mul(0.5);
      inner.position.set(-c.x, -c.y, -c.z);
      const diag = t.box.max.sub(t.box.min).len();
      const o = { inner, kantenGeo, verdeckt, sichtbar, mittel, diag, letzteV: null, letzteS: null, mlSegs: mittellinienSegmente(t), faceN, colAttr, farbModus: null };
      faerbe(o, 'iso');
      return o;
    }

    // Einfärben: in einer Normansicht alle Flächen, die zum Betrachter zeigen, in der Farbe der Ansicht;
    // in der 3D-Ansicht jede Fläche in der Farbe der Ansicht, in der sie am deutlichsten zu sehen ist.
    function faerbe(o, name) {
      if (!o || !o.colAttr || o.farbModus === name) return;
      o.farbModus = name;
      const c = new THREE.Color(), neutral = new THREE.Color(FARBEN.neutral);
      const farbe = {}; for (const k in BLICKACHSE) farbe[k] = new THREE.Color(FARBEN[k]);
      const arr = o.colAttr.array;
      o.faceN.forEach((n, i) => {
        c.copy(neutral);
        if (name === 'iso') {
          let best = 0.3, wahl = null;
          for (const k in BLICKACHSE) {
            const d = BLICKACHSE[k], dot = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
            if (dot > best) { best = dot; wahl = k; }
          }
          if (wahl) c.copy(farbe[wahl]);
        } else if (BLICKACHSE[name]) {
          const d = BLICKACHSE[name];
          if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0.02) c.copy(farbe[name]);
        }
        for (let k = 0; k < 3; k++) { arr[i * 9 + k * 3] = c.r; arr[i * 9 + k * 3 + 1] = c.g; arr[i * 9 + k * 3 + 2] = c.b; }
      });
      o.colAttr.needsUpdate = true;
    }

    function aktualisiereKanten(o, t, v, s) {
      if (o.letzteV && o.letzteV.sub(v).len() < 1e-6 && Math.abs(o.letzteKS - s) / s < 0.04) return;
      o.letzteV = v.clone();
      o.letzteKS = s;
      const sil = silhouetten(t.kanten.weich, v, 0.3 * s);
      const arr = new Float32Array(t.kanten.fest.length + sil.length);
      arr.set(t.kanten.fest, 0);
      arr.set(sil, t.kanten.fest.length);
      o.kantenGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      o.verdeckt.computeLineDistances();
    }

    function aktualisiereMittellinien(o, s) {
      if (o.letzteS && Math.abs(o.letzteS - s) / s < 0.04) return;
      o.letzteS = s;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(strichPunkt(o.mlSegs, s), 3));
      o.mittel.geometry.dispose();
      o.mittel.geometry = g;
    }

    // ---- Kamera
    let theta = ANSICHTEN.iso.theta, phi = ANSICHTEN.iso.phi, radius = 50, camDist = 500;
    let aktiv = -1, ansicht = cfg.startAnsicht || 'iso', anim = null, autoRotate = !!cfg.autoDrehen;
    let zeigeVerdeckt = cfg.verdeckteKanten !== false, zeigeMittel = cfg.mittellinien !== false;

    // Blickrichtung (zur Kamera hin) in Technik-Koordinaten
    const blick = (th, ph) => {
      const X = Math.sin(ph) * Math.sin(th), Y = Math.cos(ph), Z = Math.sin(ph) * Math.cos(th);
      return new V(X, -Z, Y);
    };

    function setzeKamera(cam, th, ph, rad, aspect, dist) {
      cam.position.set(dist * Math.sin(ph) * Math.sin(th), dist * Math.cos(ph), dist * Math.sin(ph) * Math.cos(th));
      cam.up.set(-Math.cos(ph) * Math.sin(th), Math.sin(ph), -Math.cos(ph) * Math.cos(th));
      cam.lookAt(0, 0, 0);
      cam.left = -rad * aspect; cam.right = rad * aspect; cam.top = rad; cam.bottom = -rad;
      cam.near = 0.1; cam.far = dist * 2 + 10;
      cam.updateProjectionMatrix();
    }

    const passendRadius = (o) => Math.max(o.diag * 0.62, 1);

    function resize() { renderer.setSize(wrap.clientWidth, wrap.clientHeight); }
    new ResizeObserver(resize).observe(wrap);
    resize();

    // ---- Vorschaubilder
    function vorschau(t, o) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setSize(240, 170);
      const sc = new THREE.Scene(); lichter(sc);
      const rt = new THREE.Group(); rt.rotation.x = -Math.PI / 2; sc.add(rt);
      rt.add(o.inner);
      o.verdeckt.visible = false; o.mittel.visible = false;
      aktualisiereKanten(o, t, blick(ANSICHTEN.iso.theta, ANSICHTEN.iso.phi), o.diag * 1.1 / 170);
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
      setzeKamera(cam, ANSICHTEN.iso.theta, ANSICHTEN.iso.phi, o.diag * 0.55, 240 / 170, o.diag * 3 + 10);
      r.render(sc, cam);
      const url = r.domElement.toDataURL('image/png');
      rt.remove(o.inner);
      o.verdeckt.visible = true; o.mittel.visible = true;
      r.dispose();
      if (r.forceContextLoss) r.forceContextLoss();
      return url;
    }

    // ---- UI
    const liste = $('teilListe');
    const meldung = $('meldung');
    const viewLabel = $('ansichtLabel');
    const masse = $('masse');
    const nameBtn = $('nameBtn'), nameLabel = $('nameLabel');
    const zeichnungBtn = $('zeichnungBtn');

    function zeigeName(sichtbar) {
      nameLabel.classList.toggle('hidden', !sichtbar);
      nameBtn.classList.toggle('hidden', sichtbar);
    }
    nameBtn.addEventListener('click', () => zeigeName(true));

    function waehle(i) {
      const t = teile[i];
      if (!t) return;
      while (scherGruppe.children.length) scherGruppe.remove(scherGruppe.children[0]);
      aktiv = i;
      [...liste.children].forEach((b, k) => b.classList.toggle('active', k === i));
      const def = cfg.bauteile[i];
      nameLabel.textContent = def.name || `Teil ${i + 1}`;
      zeigeName(!cfg.namenVerstecken);
      zeichnungBtn.classList.toggle('hidden', !def.zeichnung);
      if (t.fehler) {
        meldung.textContent = 'Fehler beim Berechnen: ' + t.fehler;
        meldung.classList.remove('hidden');
        masse.textContent = '';
        return;
      }
      meldung.classList.add('hidden');
      scherGruppe.add(t.obj.inner);
      radius = passendRadius(t.obj);
      camDist = t.obj.diag * 3 + 10;
      const a = t.daten.info.abmessungen;
      masse.textContent = `${fmt(a[0])} × ${fmt(a[1])} × ${fmt(a[2])} mm`;
      masse.title = 'Breite (x) × Tiefe (y) × Höhe (z)';
      geheZu(ansicht, true);
    }
    const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

    function geheZu(name, sofort) {
      const z = ANSICHTEN[name];
      if (!z) return;
      ansicht = name;
      document.querySelectorAll('[data-ansicht]').forEach(b => b.classList.toggle('active', b.dataset.ansicht === name));
      viewLabel.textContent = z.name;
      viewLabel.dataset.ansicht = name;
      if (aktiv >= 0 && teile[aktiv] && teile[aktiv].obj) faerbe(teile[aktiv].obj, name === 'kabinett' ? 'iso' : name);
      if (name !== 'iso') autoRotate = false;
      scherZiel = z.scher || 0;
      if (sofort) setzeScher(scherZiel);
      syncDrehen();
      if (aktiv >= 0 && teile[aktiv].obj) radius = passendRadius(teile[aktiv].obj);
      let dTh = z.theta - theta;
      dTh = ((dTh + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (sofort) { theta = z.theta; phi = z.phi; anim = null; return; }
      anim = { th0: theta, ph0: phi, dTh, dPh: z.phi - phi, t: 0 };
    }

    function freieAnsicht() {
      anim = null;
      if (ansicht !== null) {
        ansicht = null;
        document.querySelectorAll('[data-ansicht]').forEach(b => b.classList.remove('active'));
        viewLabel.textContent = 'Freie Ansicht';
      }
      scherZiel = 0;
      if (aktiv >= 0 && teile[aktiv] && teile[aktiv].obj) faerbe(teile[aktiv].obj, 'iso');
    }

    document.querySelectorAll('[data-ansicht]').forEach(b => b.addEventListener('click', () => geheZu(b.dataset.ansicht)));

    const tglVerdeckt = $('tglVerdeckt'), tglMittel = $('tglMittel'), tglDrehen = $('tglDrehen');
    const syncToggles = () => {
      tglVerdeckt.setAttribute('aria-pressed', zeigeVerdeckt);
      tglMittel.setAttribute('aria-pressed', zeigeMittel);
      verdecktMat.visible = zeigeVerdeckt;
      mittelMat.visible = zeigeMittel;
    };
    const syncDrehen = () => tglDrehen.setAttribute('aria-pressed', autoRotate);
    tglVerdeckt.addEventListener('click', () => { zeigeVerdeckt = !zeigeVerdeckt; syncToggles(); });
    tglMittel.addEventListener('click', () => { zeigeMittel = !zeigeMittel; syncToggles(); });
    tglDrehen.addEventListener('click', () => { autoRotate = !autoRotate; if (autoRotate) freieAnsicht(); syncDrehen(); });
    syncToggles(); syncDrehen();

    const overlay = $('zeichnungOverlay');
    zeichnungBtn.addEventListener('click', () => {
      const def = cfg.bauteile[aktiv];
      if (!def || !def.zeichnung) return;
      $('zeichnungImg').src = def.zeichnung;
      overlay.classList.remove('hidden');
    });
    const schliessen = () => overlay.classList.add('hidden');
    $('zeichnungZu').addEventListener('click', schliessen);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) schliessen(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliessen(); });

    // ---- Maus / Touch
    const zeiger = new Map();
    let pinchStart = null;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add('dragging');
      if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), r: radius };
      }
    });
    wrap.addEventListener('pointermove', (e) => {
      const p = zeiger.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (zeiger.size === 2 && pinchStart) {
        const [a, b] = [...zeiger.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 0) radius = begrenze(pinchStart.r * pinchStart.d / d);
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      autoRotate = false; syncDrehen();
      freieAnsicht();
      theta -= dx * 0.008;
      phi = Math.min(Math.max(phi - dy * 0.008, 0), Math.PI);
    });
    const ende = (e) => {
      if (!zeiger.has(e.pointerId)) return;
      zeiger.delete(e.pointerId);
      if (zeiger.size < 2) pinchStart = null;
      if (!zeiger.size) wrap.classList.remove('dragging');
    };
    wrap.addEventListener('pointerup', ende);
    wrap.addEventListener('pointercancel', ende);
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      radius = begrenze(radius * (1 + e.deltaY * 0.001));
    }, { passive: false });
    const begrenze = (r) => {
      const o = aktiv >= 0 && teile[aktiv].obj;
      const d = o ? o.diag : 100;
      return Math.min(Math.max(r, d * 0.08), d * 3);
    };

    $('resetBtn').addEventListener('click', () => geheZu(cfg.startAnsicht || 'iso'));

    // ---- Animation
    let tAlt = performance.now();
    function animate(now) {
      requestAnimationFrame(animate);
      const dt = Math.min((now - tAlt) / 1000, 0.1);
      tAlt = now;
      if (anim) {
        anim.t = Math.min(1, anim.t + dt / 0.7);
        const e = anim.t < 0.5 ? 2 * anim.t * anim.t : 1 - Math.pow(-2 * anim.t + 2, 2) / 2;
        theta = anim.th0 + anim.dTh * e;
        phi = anim.ph0 + anim.dPh * e;
        if (anim.t >= 1) anim = null;
      } else if (autoRotate) theta += 0.3 * dt;
      if (scher !== scherZiel) {
        const schritt = dt / 0.7 * 0.5 * Math.SQRT1_2;
        setzeScher(Math.abs(scherZiel - scher) <= schritt ? scherZiel : scher + Math.sign(scherZiel - scher) * schritt);
      }
      const t = teile[aktiv];
      if (t && t.obj) {
        const h = wrap.clientHeight || 1;
        const s = 2 * radius / h;                    // mm pro Pixel
        verdecktMat.dashSize = 7 * s;
        verdecktMat.gapSize = 4.5 * s;
        // Bei Scherung ist die Projektionsrichtung im Bauteil (c, -1, c) statt (0, -1, 0)
        const bv = scher > 0 ? (() => { const b = blick(theta, phi); return new V(b.x + scher * -b.y, b.y, b.z + scher * -b.y); })() : blick(theta, phi);
        aktualisiereKanten(t.obj, t.daten, bv.mul(1 / bv.len()), s);
        aktualisiereMittellinien(t.obj, s);
      }
      setzeKamera(camera, theta, phi, radius, wrap.clientWidth / Math.max(wrap.clientHeight, 1), camDist);
      renderer.render(scene, camera);
    }

    // ---- Bauteile nacheinander berechnen (die Seite bleibt dabei bedienbar)
    const bauteile = cfg.bauteile || [];
    if (bauteile.length <= 1) document.body.classList.add('einzelteil');
    meldung.textContent = 'Bauteil wird berechnet …';
    meldung.classList.remove('hidden');

    bauteile.forEach((def, i) => {
      const b = document.createElement('button');
      b.title = def.name || `Teil ${i + 1}`;
      b.setAttribute('aria-label', b.title);
      b.innerHTML = `<span class="nr">${def.nummer || i + 1}</span>`;
      b.addEventListener('click', () => waehle(i));
      liste.appendChild(b);
    });

    let i = 0;
    const naechstes = () => {
      if (i >= bauteile.length) return;
      const def = bauteile[i];
      try {
        const daten = baueBauteil(def);
        const obj = objekteFuer(daten);
        teile[i] = { daten, obj };
        status[i] = { name: def.name, ok: true, ...daten.info };
        const img = document.createElement('img');
        img.src = vorschau(daten, obj);
        img.alt = '';
        liste.children[i].prepend(img);
      } catch (e) {
        console.error(e);
        teile[i] = { fehler: e.message };
        status[i] = { name: def.name, ok: false, fehler: e.message };
      }
      if (i === 0) waehle(0);
      i++;
      setTimeout(naechstes, 0);
    };
    requestAnimationFrame(animate);
    setTimeout(naechstes, 30);

    // für Tests im Browser
    // ---- Erweiterung Ansichten-Trainer: Körper austauschen, Ansichtsbilder rendern, Bilder vergleichen
    const ZUSATZ = {
      rechts: { name: 'Ansicht von rechts', theta: Math.PI / 2, phi: Math.PI / 2 },
      hinten: { name: 'Ansicht von hinten', theta: Math.PI, phi: Math.PI / 2 },
      unten:  { name: 'Ansicht von unten', theta: 0, phi: Math.PI },
    };
    const cache = new Map();
    function hole(def) {
      const k = JSON.stringify(def.elemente);
      if (!cache.has(k)) cache.set(k, baueBauteil(def));
      return cache.get(k);
    }
    function zeige(def, start) {
      cfg.bauteile[0] = def;
      const daten = hole(def);
      if (teile[0] && teile[0].obj) entsorge(teile[0].obj);
      teile[0] = { daten, obj: objekteFuer(daten) };
      status[0] = { name: def.name, ok: true, ...daten.info };
      ansicht = start || ansicht || 'iso';
      waehle(0);
    }
    function entsorge(o) { o.inner.traverse(x => { if (x.geometry) x.geometry.dispose(); }); }
    let bildR = null, bildC = null, dickC = null;
    // Zeichnungsdarstellung: Flächen rein weiß (ohne Licht), damit keine Ansicht durch Schatten auffällt
    const weissMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
    function rendere(def, name, opt) {
      opt = opt || {};
      const W = opt.w || 220, H = opt.h || 220;
      const z = ANSICHTEN[name] || ZUSATZ[name];
      if (!z) throw new Error('Unbekannte Ansicht ' + name);
      const daten = hole(def), o = objekteFuer(daten);
      if (!bildR) bildR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      bildR.setPixelRatio(opt.pr || 1);
      bildR.setSize(W, H);
      const sc = new THREE.Scene(); lichter(sc);
      const rt = new THREE.Group(); rt.rotation.x = -Math.PI / 2; sc.add(rt);
      const sg = new THREE.Group(); sg.matrixAutoUpdate = false;
      const c = z.scher || 0;
      sg.matrix.set(1, c, 0, 0, 0, 1, 0, 0, 0, c, 1, 0, 0, 0, 0, 1); sg.matrixWorldNeedsUpdate = true;
      rt.add(sg); sg.add(o.inner);
      if (opt.farbe === 'weiss') { o.inner.children[0].material = weissMat; o.farbModus = 'weiss'; }
      else faerbe(o, BLICKACHSE[name] ? name : 'iso');
      o.mittel.visible = false;
      const rad = opt.radius || passendRadius(o), s = 2 * rad / H;
      const alt = [verdecktMat.visible, verdecktMat.dashSize, verdecktMat.gapSize];
      verdecktMat.visible = opt.verdeckt !== false;
      verdecktMat.dashSize = (opt.strich || 6) * s; verdecktMat.gapSize = (opt.luecke || 4) * s;
      let bv = blick(z.theta, z.phi);
      if (c > 0) bv = new V(bv.x + c * -bv.y, bv.y, bv.z + c * -bv.y);
      aktualisiereKanten(o, daten, bv.mul(1 / bv.len()), s);
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
      setzeKamera(cam, z.theta, z.phi, rad, W / H, o.diag * 3 + 10);
      bildR.render(sc, cam);
      [verdecktMat.visible, verdecktMat.dashSize, verdecktMat.gapSize] = alt;
      entsorge(o);
      return { W, H, pr: opt.pr || 1 };
    }
    // Linien sind in WebGL nur 1 px breit – für Ansichtskarten auf 2 px verdicken (wie eine Zeichnung)
    function bild(def, name, opt) {
      const r = rendere(def, name, opt);
      if (!opt || opt.dick === false) return bildR.domElement.toDataURL('image/png');
      if (!dickC) dickC = document.createElement('canvas');
      const w = r.W * r.pr, h = r.H * r.pr, d = Math.max(1, Math.round(r.pr));
      dickC.width = w; dickC.height = h;
      const g = dickC.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'darken';
      for (let dx = 0; dx <= d; dx++) for (let dy = 0; dy <= d; dy++) g.drawImage(bildR.domElement, dx - d / 2, dy - d / 2);
      return dickC.toDataURL('image/png');
    }
    // kleines Graustufenbild zum Vergleichen zweier Ansichten (gleich = gleiche Zeichnung)
    function signatur(def, name) {
      rendere(def, name, { w: 64, h: 64, radius: 19, farbe: 'weiss', pr: 1 });
      if (!bildC) bildC = document.createElement('canvas');
      bildC.width = 64; bildC.height = 64;
      const g = bildC.getContext('2d', { willReadFrequently: true });
      g.clearRect(0, 0, 64, 64); g.drawImage(bildR.domElement, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data, out = new Float32Array(64 * 64);
      for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] / 255 * (1 - (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765);
      return out;
    }
    function gleich(a, b) { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length < 0.004; }

    window.explorer = { ansicht: (n) => geheZu(n, true), fahre: (n) => geheZu(n), waehle, status, teile, scher: () => scher,
      zeige, bild, signatur, gleich, aktuelleAnsicht: () => ansicht };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
