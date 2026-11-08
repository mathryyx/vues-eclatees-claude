// Petit moteur 3D fait main (dérivé de celui de FIG. 01) : faces planes
// éventuellement concaves et trouées, projection orthographique, tri du
// peintre par groupes, traits fins sur silhouettes et arêtes vives,
// faces de coupe hachurées.

export type V3 = [number, number, number];
export type V2 = [number, number];

export type Kind = 'solid' | 'cut' | 'inner';

export interface Face {
  pts: V3[];
  holes?: V3[][];
  color: string;
  kind: Kind;
  hatch?: 'A' | 'B';
  group: number;
  soft?: number[]; // par arête : indice de la face voisine (arête douce) ou -1 (arête vive)
  noEdge?: boolean;
  tag?: string;
}

export interface Line3 {
  pts: V3[];
  w: number;
  color: string;
  group: number;
}

export interface Part {
  faces: Face[];
  lines: Line3[];
}

export const newPart = (): Part => ({faces: [], lines: []});

// ---------- vecteurs ----------
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const newell = (pts: V3[]): V3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    x += (p[1] - q[1]) * (p[2] + q[2]);
    y += (p[2] - q[2]) * (p[0] + q[0]);
    z += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rotation autour de l'axe x (axe du rotor), centre sur l'axe. */
export const rotX = (p: V3, ang: number): V3 => {
  if (!ang) return p;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
};

// ---------- formes 2D ----------
export const signedArea = (pts: V2[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};
export const ccw = (pts: V2[]) => (signedArea(pts) < 0 ? [...pts].reverse() : pts);
export const cw = (pts: V2[]) => (signedArea(pts) > 0 ? [...pts].reverse() : pts);
export const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): V2[] =>
  Array.from({length: n + 1}, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as V2;
  });
export const circle = (cx: number, cy: number, r: number, n = 24): V2[] =>
  Array.from({length: n}, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as V2;
  });

// ---------- construction ----------
/** Ajoute une face orientée selon la normale extérieure `hint`. */
export const addFace = (part: Part, pts: V3[], hint: V3, o: Omit<Face, 'pts'>) => {
  let p = pts;
  if (dot(newell(p), hint) < 0) p = [...p].reverse();
  let holes = o.holes;
  if (holes) holes = holes.map((h) => (dot(newell(h), hint) > 0 ? [...h].reverse() : h));
  part.faces.push({...o, pts: p, holes});
  return part.faces.length - 1;
};

type Map3 = (u: number, v: number, t: number) => V3;

/**
 * Prisme : contour 2D (u,v) extrudé de t0 à t1 par une application affine `map`.
 * Faces latérales (avec arêtes douces si le contour est lisse) puis couvercles.
 */
export const prism = (
  part: Part,
  outline: V2[],
  holes: V2[][],
  t0: number,
  t1: number,
  map: Map3,
  o: {color: string; capColor?: string; sideGroup?: number; capGroup?: number; smooth?: number; caps?: 'both' | 't0' | 't1' | 'none'; tag?: string},
) => {
  const out = ccw(outline);
  const hs = holes.map(cw);
  const smooth = Math.cos(((o.smooth ?? 32) * Math.PI) / 180);
  const sideGroup = o.sideGroup ?? 0;
  const loops = [out, ...hs];
  for (const loop of loops) {
    const n = loop.length;
    const base = part.faces.length;
    // directions des arêtes pour tester la douceur
    const dirs = loop.map((p, i) => {
      const q = loop[(i + 1) % n];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      return [(q[0] - p[0]) / l, (q[1] - p[1]) / l] as V2;
    });
    for (let i = 0; i < n; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % n];
      const d = dirs[i];
      const nrm: V2 = [d[1], -d[0]]; // extérieur pour un contour trigo
      const p0 = map(a[0], a[1], t0);
      const hint = sub(map(a[0] + nrm[0], a[1] + nrm[1], t0), p0);
      const prev = dirs[(i - 1 + n) % n];
      const next = dirs[(i + 1) % n];
      const softPrev = prev[0] * d[0] + prev[1] * d[1] > smooth;
      const softNext = next[0] * d[0] + next[1] * d[1] > smooth;
      const pts: V3[] = [map(a[0], a[1], t0), map(b[0], b[1], t0), map(b[0], b[1], t1), map(a[0], a[1], t1)];
      // l'ordre peut être inversé par addFace : on recalcule les voisins après coup
      const fi = addFace(part, pts, hint, {color: o.color, kind: 'solid', group: sideGroup, tag: o.tag});
      const f = part.faces[fi];
      const reversed = f.pts[0] !== pts[0];
      const iPrev = base + ((i - 1 + n) % n);
      const iNext = base + ((i + 1) % n);
      // arêtes de pts : [t0 a->b], [b t0->t1], [t1 b->a], [a t1->t0]
      const s = [-1, softNext ? iNext : -1, -1, softPrev ? iPrev : -1];
      f.soft = reversed ? [s[2], s[1], s[0], s[3]] : s;
      // si inversé : pts = [a1, b1, b0, a0] -> arêtes [t1 a->b], [b t1->t0], [t0 b->a], [a t0->t1]
    }
  }
  const caps = o.caps ?? 'both';
  const cap = (t: number, sign: number) => {
    const p0 = map(0, 0, t);
    const hint = sub(map(0, 0, t + sign), p0);
    addFace(part, out.map(([u, v]) => map(u, v, t)), hint, {
      color: o.capColor ?? o.color,
      kind: 'solid',
      group: o.capGroup ?? sideGroup + 1,
      holes: hs.length ? hs.map((h) => h.map(([u, v]) => map(u, v, t))) : undefined,
      tag: o.tag,
    });
  };
  if (caps === 'both' || caps === 't0') cap(t0, -Math.sign(t1 - t0));
  if (caps === 'both' || caps === 't1') cap(t1, Math.sign(t1 - t0));
};

/**
 * Surface de révolution : profil [rayon, t] (t le long de l'axe), angles a0..a1.
 * `pt(r, ang, t)` donne le point 3D. inward : normales vers l'axe.
 */
export const revolve = (
  part: Part,
  profile: [number, number][],
  a0: number,
  a1: number,
  n: number,
  pt: (r: number, ang: number, t: number) => V3,
  axisPt: (t: number) => V3,
  o: {color: string; kind?: Kind; group?: number; inward?: boolean; capStart?: string; capEnd?: string; capGroup?: number; tag?: string; full?: boolean},
) => {
  const full = o.full ?? Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const segs = n;
  const base = part.faces.length;
  const bands = profile.length - 1;
  const idx = (j: number, i: number) => base + j * segs + i;
  for (let j = 0; j < bands; j++) {
    const [r0, t0] = profile[j];
    const [r1, t1] = profile[j + 1];
    for (let i = 0; i < segs; i++) {
      const g0 = a0 + ((a1 - a0) * i) / segs;
      const g1 = a0 + ((a1 - a0) * (i + 1)) / segs;
      const gm = (g0 + g1) / 2;
      const pts: V3[] = [pt(r0, g0, t0), pt(r0, g1, t0), pt(r1, g1, t1), pt(r1, g0, t1)];
      const c = pt((r0 + r1) / 2, gm, (t0 + t1) / 2);
      const ax = axisPt((t0 + t1) / 2);
      let hint = sub(c, ax);
      if (o.inward) hint = [-hint[0], -hint[1], -hint[2]];
      const fi = addFace(part, pts, hint, {color: o.color, kind: o.kind ?? 'solid', group: o.group ?? 0, tag: o.tag});
      const f = part.faces[fi];
      const reversed = f.pts[0] !== pts[0];
      const left = i > 0 ? idx(j, i - 1) : full ? idx(j, segs - 1) : -1;
      const right = i < segs - 1 ? idx(j, i + 1) : full ? idx(j, 0) : -1;
      // arêtes de pts : [t0 g0->g1], [g1 t0->t1], [t1 g1->g0], [g0 t1->t0]
      const s = [-1, right, -1, left];
      f.soft = reversed ? [s[2], s[1], s[0], s[3]] : s;
    }
  }
  const capAt = (j: number, color: string, sign: number) => {
    const [r, t] = profile[j];
    if (r < 1e-6) return;
    const ring: V3[] = [];
    for (let i = 0; i <= segs; i++) {
      if (full && i === segs) break;
      ring.push(pt(r, a0 + ((a1 - a0) * i) / segs, t));
    }
    const ax = axisPt(t);
    if (!full) ring.push(ax);
    const ahead = axisPt(t + sign);
    addFace(part, ring, sub(ahead, ax), {color, kind: 'solid', group: o.capGroup ?? o.group ?? 0, tag: o.tag});
  };
  if (o.capStart) capAt(0, o.capStart, -Math.sign(profile[profile.length - 1][1] - profile[0][1]));
  if (o.capEnd) capAt(profile.length - 1, o.capEnd, Math.sign(profile[profile.length - 1][1] - profile[0][1]));
};

// ---------- caméra ----------
export interface Cam {
  az: number;
  el: number;
  scale: number;
  tx: number;
  ty: number;
  tz: number;
  cx: number;
  cy: number;
}

export const project = (p: V3, c: Cam): V3 => {
  const x = p[0] - c.tx;
  const y = p[1] - c.ty;
  const z = p[2] - c.tz;
  const ca = Math.cos(c.az);
  const sa = Math.sin(c.az);
  const xr = x * ca - y * sa;
  const yr = x * sa + y * ca;
  const se = Math.sin(c.el);
  const ce = Math.cos(c.el);
  return [c.cx + c.scale * xr, c.cy - c.scale * (yr * se + z * ce), yr * ce - z * se];
};

// ---------- couleurs ----------
const hex = (h: string): V3 => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c: V3) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a: string, b: string, t: number) => {
  const A = hex(a);
  const B = hex(b);
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
};
const SHADOW = '#1D2340';
const LIGHT: V3 = (() => {
  const v: V3 = [-0.35, -0.6, 0.72];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const shadeCache = new Map<string, string>();
export const shade = (color: string, n: V3) => {
  const d = dot(n, LIGHT);
  let k: number;
  if (n[2] > 0.93) k = 0;
  else k = Math.round((0.05 + 0.3 * Math.min(1, Math.max(0, (0.85 - d) / 1.1))) * 25) / 25;
  const key = color + k;
  let v = shadeCache.get(key);
  if (!v) {
    v = mix(color, SHADOW, k);
    shadeCache.set(key, v);
  }
  return v;
};

// ---------- rendu ----------
export interface DrawItem {
  fill: string;
  d: string;
  edges: string;
  ew: number;
  hatch?: string;
  stroke?: string;
}

const f1 = (v: number) => Math.round(v * 10) / 10;
const pathOf = (pts: V3[]) => {
  let d = '';
  pts.forEach((p, k) => (d += (k ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1])));
  return d + 'Z';
};

export interface RenderOpts {
  xf: (p: V3) => V3;
  cull?: (worldCenter: V3, f: Face) => boolean;
  tint?: number;
  tintColor?: string;
  edgeW?: number;
}

export const renderPart = (part: Part, cam: Cam, opts: RenderOpts, out: DrawItem[]) => {
  const {faces} = part;
  const nF = faces.length;
  const world: V3[][] = new Array(nF);
  const scr: V3[][] = new Array(nF);
  const front = new Uint8Array(nF);
  const depth = new Float64Array(nF);
  const skip = new Uint8Array(nF);
  for (let fi = 0; fi < nF; fi++) {
    const f = faces[fi];
    const w = f.pts.map(opts.xf);
    world[fi] = w;
    const s = w.map((p) => project(p, cam));
    scr[fi] = s;
    let a = 0;
    let dsum = 0;
    for (let k = 0; k < s.length; k++) {
      const p = s[k];
      const q = s[(k + 1) % s.length];
      a += p[0] * q[1] - q[0] * p[1];
      dsum += p[2];
    }
    front[fi] = a < -0.01 ? 1 : 0;
    depth[fi] = dsum / s.length;
    if (opts.cull) {
      const c: V3 = [0, 0, 0];
      for (const p of w) {
        c[0] += p[0] / w.length;
        c[1] += p[1] / w.length;
        c[2] += p[2] / w.length;
      }
      if (opts.cull(c, f)) skip[fi] = 1;
    }
  }
  const groups = new Set<number>();
  faces.forEach((f) => groups.add(f.group));
  part.lines.forEach((l) => groups.add(l.group));
  const sortedGroups = [...groups].sort((a, b) => a - b);
  const ew0 = opts.edgeW ?? 1;
  for (const g of sortedGroups) {
    const order: number[] = [];
    for (let fi = 0; fi < nF; fi++) if (faces[fi].group === g && front[fi] && !skip[fi]) order.push(fi);
    order.sort((x, y) => depth[y] - depth[x]);
    for (const fi of order) {
      const f = faces[fi];
      const pts = scr[fi];
      let col = f.color;
      if (f.kind !== 'cut') col = shade(col, newell(world[fi]));
      if (opts.tint && opts.tintColor) col = mix(col, opts.tintColor, opts.tint);
      let d = pathOf(pts);
      let edges = '';
      if (f.holes) {
        for (const h of f.holes) {
          const hs = h.map((p) => project(opts.xf(p), cam));
          d += pathOf(hs);
          if (!f.noEdge) {
            for (let k = 0; k < hs.length; k++) {
              const p = hs[k];
              const q = hs[(k + 1) % hs.length];
              edges += 'M' + f1(p[0]) + ' ' + f1(p[1]) + 'L' + f1(q[0]) + ' ' + f1(q[1]);
            }
          }
        }
      }
      if (!f.noEdge) {
        for (let k = 0; k < pts.length; k++) {
          const nb = f.soft ? f.soft[k] : -1;
          if (nb >= 0 && front[nb] && !skip[nb]) continue;
          const p = pts[k];
          const q = pts[(k + 1) % pts.length];
          edges += 'M' + f1(p[0]) + ' ' + f1(p[1]) + 'L' + f1(q[0]) + ' ' + f1(q[1]);
        }
      }
      out.push({
        fill: col,
        d,
        edges,
        ew: (f.kind === 'inner' ? 0.65 : 1) * ew0,
        hatch: f.kind === 'cut' ? f.hatch : undefined,
      });
    }
    for (const l of part.lines) {
      if (l.group !== g) continue;
      const s = l.pts.map((p) => project(opts.xf(p), cam));
      let d = '';
      s.forEach((p, k) => (d += (k ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1])));
      out.push({fill: 'none', d: '', edges: d, ew: l.w, stroke: l.color});
    }
  }
};

/** Boîte englobante écran (échelle 1, centre 0) des sommets d'une pièce. */
export const bboxPart = (part: Part, xf: (p: V3) => V3, cam: Cam, bb: number[]) => {
  for (const f of part.faces) {
    for (const p of f.pts) {
      const s = project(xf(p), cam);
      if (s[0] < bb[0]) bb[0] = s[0];
      if (s[1] < bb[1]) bb[1] = s[1];
      if (s[0] > bb[2]) bb[2] = s[0];
      if (s[1] > bb[3]) bb[3] = s[1];
    }
  }
};
