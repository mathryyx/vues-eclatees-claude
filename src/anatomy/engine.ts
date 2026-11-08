// Mini moteur 3D fait main : maillages par « loft » d'anneaux, projection
// orthographique isométrique, tri du peintre par couches / pièces / bandes,
// traits fins uniquement sur silhouettes et arêtes vives.

export type V3 = [number, number, number];
export type V2 = [number, number];

export interface Face {
  idx: number[];
  color: string;
  band: number; // ordre de dessin à l'intérieur d'une pièce convexe
  layer: number; // ordre de dessin à l'intérieur d'une partie
  piece: number;
  flatShade?: boolean; // pas d'ombrage (décors)
}

export interface Geo {
  verts: V3[];
  faces: Face[];
  pieces: number;
}

export interface Topo {
  neighbors: number[][];
  crease: boolean[][];
  pieceVerts: number[][];
}

export const newGeo = (): Geo => ({verts: [], faces: [], pieces: 0});

type Axis = 'x' | 'y' | 'z';
const mapAxis = (p: V3, axis: Axis): V3 => {
  // (X,Y,Z) local -> monde, rotations propres (permutations cycliques)
  if (axis === 'x') return [p[2], p[0], p[1]];
  if (axis === 'y') return [p[1], p[2], p[0]];
  return p;
};

export interface LoftOpts {
  color: string;
  topColor?: string;
  bottomColor?: string;
  capTop?: boolean;
  capBottom?: boolean;
  layer?: number;
  axis?: Axis;
  offset?: V3;
  piece?: number;
}

const addVert = (g: Geo, p: V3, o: LoftOpts) => {
  const q = mapAxis(p, o.axis ?? 'z');
  const off = o.offset ?? [0, 0, 0];
  g.verts.push([q[0] + off[0], q[1] + off[1], q[2] + off[2]]);
  return g.verts.length - 1;
};

/** Anneaux ordonnés du bas vers le haut, chaque anneau en sens trigo vu du dessus. */
export const loft = (g: Geo, rings: V3[][], o: LoftOpts): number => {
  const piece = o.piece ?? g.pieces++;
  const layer = o.layer ?? 0;
  const n = rings[0].length;
  const ids = rings.map((r) => r.map((p) => addVert(g, p, o)));
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      g.faces.push({
        idx: [ids[j][i], ids[j][i2], ids[j + 1][i2], ids[j + 1][i]],
        color: o.color,
        band: j,
        layer,
        piece,
      });
    }
  }
  if (o.capTop !== false) {
    g.faces.push({idx: [...ids[rings.length - 1]], color: o.topColor ?? o.color, band: rings.length, layer, piece});
  }
  if (o.capBottom !== false) {
    g.faces.push({idx: [...ids[0]].reverse(), color: o.bottomColor ?? o.color, band: -1, layer, piece});
  }
  return piece;
};

/** Polygone plat posé sur une surface (décor), dessiné après sa pièce. */
export const decal = (g: Geo, poly: V2[], z: number, color: string, piece: number, layer = 0, band = 1000) => {
  const ids = poly.map(([x, y]) => {
    g.verts.push([x, y, z]);
    return g.verts.length - 1;
  });
  g.faces.push({idx: ids, color, band, layer, piece, flatShade: true});
};

// ---------- formes 2D ----------
export const circle = (cx: number, cy: number, r: number, n = 36, a0 = 0): V2[] =>
  Array.from({length: n}, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as V2;
  });

export const ring = (pts: V2[], z: number): V3[] => pts.map(([x, y]) => [x, y, z]);

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

export const catmullClosed = (ctrl: V2[], per = 6): V2[] => {
  const out: V2[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
};

/** Décalage vers l'intérieur (polygone trigo), jointure en onglet bornée. */
export const inset = (pts: V2[], d: number): V2[] => {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const e1 = norm2([p[0] - a[0], p[1] - a[1]]);
    const e2 = norm2([b[0] - p[0], b[1] - p[1]]);
    const n1: V2 = [-e1[1], e1[0]];
    const n2: V2 = [-e2[1], e2[0]];
    const s = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const k = d / Math.max(s, 0.35);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k] as V2;
  });
};

const norm2 = (v: V2): V2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

export const roundRect = (cx: number, cy: number, w: number, h: number, r: number, per = 6): V2[] => {
  const pts: V2[] = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - r, cy - h / 2 + r, -Math.PI / 2],
    [cx + w / 2 - r, cy + h / 2 - r, 0],
    [cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2],
    [cx - w / 2 + r, cy - h / 2 + r, Math.PI],
  ];
  for (const [x, y, a0] of corners) {
    for (let k = 0; k <= per; k++) {
      const a = a0 + (k / per) * (Math.PI / 2);
      pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
    }
  }
  return pts;
};

export const plus = (cx: number, cy: number, arm: number, half: number): V2[] => {
  const a = arm / 2;
  const h = half;
  return ccw([
    [a, -h], [a, -a], [h, -a], [h, a], [a, a], [a, h],
    [-a, h], [-a, a], [-h, a], [-h, -a], [-a, -a], [-a, -h],
  ].map(([x, y]) => [cx + x, cy + y] as V2));
};

// ---------- vecteurs ----------
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const newell = (pts: V3[]): V3 => {
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
export const rotAround = (p: V3, c: V3, axis: Axis, ang: number): V3 => {
  if (!ang) return p;
  const d = sub(p, c);
  const co = Math.cos(ang);
  const si = Math.sin(ang);
  let r: V3;
  if (axis === 'z') r = [d[0] * co - d[1] * si, d[0] * si + d[1] * co, d[2]];
  else if (axis === 'x') r = [d[0], d[1] * co - d[2] * si, d[1] * si + d[2] * co];
  else r = [d[0] * co + d[2] * si, d[1], -d[0] * si + d[2] * co];
  return [r[0] + c[0], r[1] + c[1], r[2] + c[2]];
};

export const buildTopo = (g: Geo): Topo => {
  const map = new Map<string, number[]>();
  g.faces.forEach((f, fi) => {
    f.idx.forEach((a, k) => {
      const b = f.idx[(k + 1) % f.idx.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const arr = map.get(key);
      if (arr) arr.push(fi);
      else map.set(key, [fi]);
    });
  });
  const normals = g.faces.map((f) => newell(f.idx.map((i) => g.verts[i])));
  const neighbors: number[][] = [];
  const crease: boolean[][] = [];
  g.faces.forEach((f, fi) => {
    const nb: number[] = [];
    const cr: boolean[] = [];
    f.idx.forEach((a, k) => {
      const b = f.idx[(k + 1) % f.idx.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const arr = map.get(key) ?? [];
      const other = arr.find((x) => x !== fi);
      nb.push(other ?? -1);
      if (other === undefined) cr.push(true);
      else {
        const n1 = normals[fi];
        const n2 = normals[other];
        cr.push(n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < Math.cos((33 * Math.PI) / 180));
      }
    });
    neighbors.push(nb);
    crease.push(cr);
  });
  const pieceVerts: number[][] = Array.from({length: g.pieces}, () => []);
  const seen: Set<number>[] = Array.from({length: g.pieces}, () => new Set());
  g.faces.forEach((f) => f.idx.forEach((i) => {
    if (!seen[f.piece].has(i)) {
      seen[f.piece].add(i);
      pieceVerts[f.piece].push(i);
    }
  }));
  return {neighbors, crease, pieceVerts};
};

// ---------- caméra ----------
export interface Cam {
  az: number; // radians
  el: number;
  scale: number;
  cx: number;
  cy: number;
  cz: number;
}

export const project = (p: V3, c: Cam): V3 => {
  const ca = Math.cos(c.az);
  const sa = Math.sin(c.az);
  const xr = p[0] * ca - p[1] * sa;
  const yr = p[0] * sa + p[1] * ca;
  const z = p[2] - c.cz;
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
const shadeCache = new Map<string, string>();
const SHADOW = '#1D2340';
const LIGHT: V3 = (() => {
  const v: V3 = [-0.45, -0.55, 0.7];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const shade = (color: string, n: V3) => {
  const d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
  let k: number;
  if (n[2] > 0.93) k = 0;
  else k = Math.round((0.07 + 0.29 * Math.min(1, Math.max(0, (0.8 - d) / 1.0))) * 50) / 50;
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
}

export interface PartInstance {
  geo: Geo;
  topo: Topo;
  xf: (p: V3, piece: number) => V3;
  tint?: number; // 0..1 mélange vers l'accent
  tintColor?: string;
}

const f1 = (v: number) => Math.round(v * 10) / 10;

export const renderPart = (inst: PartInstance, cam: Cam, out: DrawItem[]) => {
  const {geo, topo} = inst;
  const pieceOfVert = new Int32Array(geo.verts.length).fill(-1);
  geo.faces.forEach((f) => f.idx.forEach((i) => (pieceOfVert[i] = f.piece)));
  const world: V3[] = geo.verts.map((v, i) => inst.xf(v, Math.max(0, pieceOfVert[i])));
  const scr: V3[] = world.map((w) => project(w, cam));
  const pieceDepth = topo.pieceVerts.map((vs) => vs.reduce((s, i) => s + scr[i][2], 0) / Math.max(1, vs.length));
  const nF = geo.faces.length;
  const front = new Uint8Array(nF);
  const depth = new Float64Array(nF);
  for (let fi = 0; fi < nF; fi++) {
    const idx = geo.faces[fi].idx;
    let a = 0;
    let dsum = 0;
    for (let k = 0; k < idx.length; k++) {
      const p = scr[idx[k]];
      const q = scr[idx[(k + 1) % idx.length]];
      a += p[0] * q[1] - q[0] * p[1];
      dsum += p[2];
    }
    front[fi] = a < -0.01 ? 1 : 0;
    depth[fi] = dsum / idx.length;
  }
  const order: number[] = [];
  for (let fi = 0; fi < nF; fi++) if (front[fi]) order.push(fi);
  order.sort((x, y) => {
    const fx = geo.faces[x];
    const fy = geo.faces[y];
    if (fx.layer !== fy.layer) return fx.layer - fy.layer;
    if (fx.piece !== fy.piece) return pieceDepth[fy.piece] - pieceDepth[fx.piece];
    if (fx.band !== fy.band) return fx.band - fy.band;
    return depth[y] - depth[x];
  });
  for (const fi of order) {
    const f = geo.faces[fi];
    const pts = f.idx.map((i) => scr[i]);
    let col = f.color;
    if (!f.flatShade) col = shade(col, newell(f.idx.map((i) => world[i])));
    if (inst.tint && inst.tintColor) col = mix(col, inst.tintColor, inst.tint);
    let d = '';
    pts.forEach((p, k) => (d += (k ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1])));
    d += 'Z';
    let edges = '';
    const nb = topo.neighbors[fi];
    const cr = topo.crease[fi];
    for (let k = 0; k < pts.length; k++) {
      const o = nb[k];
      if (o < 0 || cr[k] || !front[o]) {
        const p = pts[k];
        const q = pts[(k + 1) % pts.length];
        edges += 'M' + f1(p[0]) + ' ' + f1(p[1]) + 'L' + f1(q[0]) + ' ' + f1(q[1]);
      }
    }
    out.push({fill: col, d, edges});
  }
};
