// Le burger parfait, modélisé à la main. Unités : millimètres.
// Repère : x à droite, y vers l'arrière, z vers le haut. Le talon repose sur z = 0.
import {V2, V3, Geo, Topo, Face, newGeo, loft, decal, poly3, ring, circle, ccw, buildTopo, roundRect} from './engine';

export const C = {
  paper: '#F2EEE5',
  grid: '#E3DDD0',
  ink: '#1C2030',
  soft: '#8B8F9E',
  accent: '#F07A3A',
  shadow: '#E2D9C8',
  // pain
  crustHi: '#EEC07A',
  crustMid: '#E2A04F',
  crust: '#D3832F',
  crustTop: '#C87428',
  crumb: '#F4D9A0',
  toast: '#E2AE62',
  sesame: '#FFF4DA',
  sesameEdge: '#A8662A',
  // garniture
  lettuceSide: '#5C9E37',
  lettuce: '#8DCB57',
  lettuceIn: '#A6D96F',
  lettuceVein: '#CDEBA0',
  tomatoSide: '#D23A2B',
  tomato: '#E9503A',
  tomatoGel: '#F69A6C',
  tomatoSeed: '#FCE29A',
  tomatoCore: '#F07254',
  onionSide: '#8A3A7B',
  onionBand: '#A9508F',
  onion: '#F4DFEC',
  onionIn: '#DDB6D2',
  pickleSide: '#557F2A',
  pickle: '#B5CC68',
  pickleCore: '#D3E38F',
  pickleSeed: '#EEF1C4',
  cheeseSide: '#E59D1C',
  cheese: '#F7BE34',
  pattySide: '#653722',
  patty: '#7D4A2C',
  grill: '#3E2115',
  sauceSide: '#E48A47',
  sauce: '#F3A862',
  sauceHi: '#FBD3A4',
};

// pseudo-aléatoire déterministe
const rng = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

export type Anchor = {kind: 'rim'; r: number; z: number} | {kind: 'pts'; pts: V3[]};

export interface LayerDef {
  id: string;
  n: string;
  name: string;
  grams: number;
  detail: string;
  geo: Geo;
  topo: Topo;
  z0: number; // base, burger monté
  zx: number; // base, vue éclatée
  top: number; // épaisseur au centre (pour les traits d'axe)
  side: 'L' | 'R';
  anchor: Anchor;
  spin: number; // rotation propre en vue éclatée (degrés)
}

const mk = (build: (g: Geo) => void) => {
  const g = newGeo();
  build(g);
  return {geo: g, topo: buildTopo(g)};
};

const sc = (pts: V2[], k: number, cx = 0, cy = 0): V2[] => pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
const tr = (pts: V2[], dx: number, dy: number): V2[] => pts.map(([x, y]) => [x + dx, y + dy]);
const rot2 = (pts: V2[], a: number): V2[] => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};
const ellipse = (cx: number, cy: number, a: number, b: number, rotA: number, n = 10): V2[] =>
  rot2(Array.from({length: n}, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [a * Math.cos(t), b * Math.sin(t)] as V2;
  }), rotA).map(([x, y]) => [x + cx, y + cy] as V2);

/** Contour circulaire irrégulier. */
const wobblyCircle = (cx: number, cy: number, r: number, amp: number, n: number, seed: number, harm = [3, 5, 7]): V2[] => {
  const R = rng(seed);
  const ph = harm.map(() => R() * Math.PI * 2);
  const am = harm.map(() => 0.5 + R() * 0.5);
  return Array.from({length: n}, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    let rr = r;
    harm.forEach((h, k) => (rr += (amp * am[k] * Math.sin(h * t + ph[k])) / harm.length));
    return [cx + rr * Math.cos(t), cy + rr * Math.sin(t)] as V2;
  });
};

/** Anneau plein (rondelle d'oignon) : radii du plus grand au plus petit, couleurs des bandes du dessus. */
const annulus = (g: Geo, cx: number, cy: number, radii: number[], tops: string[], z0: number, z1: number, side: string, inner: string, n = 36) => {
  const piece = g.pieces++;
  const base = (r: number, z: number) => circle(cx, cy, r, n).map(([x, y]) => {
    g.verts.push([x, y, z]);
    return g.verts.length - 1;
  });
  const rOut = radii[0];
  const rIn = radii[radii.length - 1];
  const ob = base(rOut, z0);
  const tops3 = radii.map((r) => base(r, z1));
  const ib = base(rIn, z0);
  const ot = tops3[0];
  const it = tops3[tops3.length - 1];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // paroi intérieure (normale vers le centre) : dessinée en premier
    g.faces.push({idx: [ib[j], ib[i], it[i], it[j]], color: inner, band: 0, layer: 0, piece});
    // paroi extérieure
    g.faces.push({idx: [ob[i], ob[j], ot[j], ot[i]], color: side, band: 1, layer: 0, piece});
    // dessus, par bandes concentriques
    for (let k = 0; k < tops3.length - 1; k++) {
      const a = tops3[k];
      const b = tops3[k + 1];
      g.faces.push({idx: [a[i], a[j], b[j], b[i]], color: tops[k], band: 2, layer: 0, piece, flatShade: true});
    }
    // dessous
    g.faces.push({idx: [ob[j], ob[i], ib[i], ib[j]], color: side, band: -1, layer: 0, piece});
  }
  return piece;
};

// ---------- 09 talon ----------
const bottomBun = mk((g) => {
  const prof: [number, number][] = [[46, 0], [50.5, 1.5], [53.5, 4.5], [55, 9], [55.4, 15], [55, 22]];
  const p = loft(g, prof.map(([r, z]) => ring(circle(0, 0, r, 56), z)), {
    color: C.crust,
    topColor: C.toast,
    bandColor: (j) => (j < 2 ? C.crust : j < 3 ? C.crustMid : C.crustHi),
  });
  decal(g, wobblyCircle(0, 0, 47.5, 1.6, 56, 11), 22.2, C.crumb, p);
  // alvéoles de mie
  const R = rng(91);
  for (let k = 0; k < 16; k++) {
    const a = R() * Math.PI * 2;
    const rr = 6 + R() * 36;
    decal(g, ellipse(rr * Math.cos(a), rr * Math.sin(a), 1.3 + R() * 1.4, 0.8 + R() * 0.7, R() * 3, 8), 22.3, C.toast, p, 0, 1001);
  }
});

// ---------- 08 sauce ----------
const sauce = mk((g) => {
  const out = ccw(wobblyCircle(0, 0, 43, 8, 72, 5, [4, 6, 9]));
  const p = loft(g, [ring(sc(out, 0.97), 0), ring(out, 1.6), ring(sc(out, 0.86), 2.6), ring(sc(out, 0.5), 3)], {
    color: C.sauceSide,
    topColor: C.sauce,
    bandColor: (j) => (j === 0 ? C.sauceSide : C.sauce),
  });
  decal(g, ellipse(-14, 10, 9, 3.2, 0.5, 14), 3.15, C.sauceHi, p);
  decal(g, ellipse(18, -12, 6, 2.2, 0.4, 12), 3.15, C.sauceHi, p);
  decal(g, ellipse(-4, -26, 4, 1.6, 0.2, 10), 3.15, C.sauceHi, p);
});

// ---------- 07 steak ----------
const patty = mk((g) => {
  const out = ccw(wobblyCircle(0, 0, 56.5, 3.2, 64, 7, [5, 7, 11, 13]));
  const prof: [number, number][] = [[0.955, 0], [0.993, 4], [1.0, 8.5], [0.988, 13], [0.95, 16.5]];
  const p = loft(g, prof.map(([k, z]) => ring(sc(out, k), z)), {color: C.pattySide, topColor: C.patty});
  // marques de grill
  const ang = 0.6;
  for (let k = -2; k <= 2; k++) {
    const d = k * 15;
    const half = Math.sqrt(Math.max(0, 44 * 44 - d * d)) - 4;
    const rr = rot2(roundRect(0, d, half * 2, 5.2, 2.6, 4), ang);
    decal(g, ccw(rr), 16.7, C.grill, p);
  }
  // grain de la viande
  const R = rng(33);
  for (let k = 0; k < 22; k++) {
    const a = R() * Math.PI * 2;
    const rr = 8 + R() * 40;
    decal(g, ellipse(rr * Math.cos(a), rr * Math.sin(a), 1.6 + R(), 0.9 + R() * 0.6, R() * 3, 7), 16.75, '#6A3B22', p, 0, 999);
  }
});

// ---------- 06 cheddar ----------
const cheese = mk((g) => {
  const sq = ccw(rot2(roundRect(0, 0, 100, 100, 7, 6), 0.38));
  const droop = (x: number, y: number) => {
    const r = Math.hypot(x, y);
    return -0.42 * Math.pow(Math.max(0, r - 54), 1.5);
  };
  const R = (pts: V2[], z: number): V3[] => pts.map(([x, y]) => [x, y, z + droop(x, y)]);
  loft(g, [R(sq, 0), R(sq, 2.2), R(sc(sq, 0.95), 2.3), R(sc(sq, 0.88), 2.4), R(sc(sq, 0.75), 2.5), R(sc(sq, 0.5), 2.5)], {
    color: C.cheeseSide,
    topColor: C.cheese,
    bandColor: (j) => (j === 0 ? C.cheeseSide : C.cheese),
  });
});

// ---------- 05 cornichons ----------
const PICKLES: [number, number, number][] = [[-31, 8, 0.2], [27, -15, 1.1], [3, 31, 2.0], [-7, -34, 2.7]];
const pickles = mk((g) => {
  for (const [cx, cy, a0] of PICKLES) {
    const n = 56;
    const out = ccw(Array.from({length: n}, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      const r = 13.5 + 0.8 * Math.cos(14 * t);
      return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as V2;
    }));
    const p = loft(g, [ring(out, 0), ring(out, 3.4)], {color: C.pickleSide, topColor: C.pickle});
    decal(g, circle(cx, cy, 8.6, 24), 3.5, C.pickleCore, p);
    for (let k = 0; k < 6; k++) {
      const a = a0 + (k / 6) * Math.PI * 2;
      decal(g, ellipse(cx + 5.6 * Math.cos(a), cy + 5.6 * Math.sin(a), 1.6, 0.9, a, 8), 3.55, C.pickleSeed, p, 0, 1001);
    }
  }
});

// ---------- 04 oignon rouge ----------
const ONIONS: [number, number, number][] = [[-22, -21, 20], [25, 11, 17.5], [-18, 27, 15.5], [21, -31, 13.5]];
const onion = mk((g) => {
  for (const [cx, cy, r] of ONIONS) {
    annulus(g, cx, cy, [r, r - 1.3, r - 3.8], [C.onionBand, C.onion], 0, 3, C.onionSide, C.onionIn, 40);
  }
});

// ---------- 03 tomate ----------
const TOMATOES: [number, number, number, number][] = [[-20, 6, 0, 0.3], [21, -5, 1.8, 1.2]];
const tomato = mk((g) => {
  TOMATOES.forEach(([cx, cy, z, a0], li) => {
    const out = ccw(wobblyCircle(cx, cy, 33, 1.2, 48, 40 + li));
    const tilt = li ? -0.035 : 0;
    const zf = (x: number) => z + (x - cx) * tilt;
    const R = (pts: V2[], dz: number): V3[] => pts.map(([x, y]) => [x, y, zf(x) + dz]);
    const p = loft(g, [R(out, 0), R(out, 5.5)], {color: C.tomatoSide, topColor: C.tomato, layer: li});
    // loges, graines, cœur
    const top = (pts: V2[], dz: number, color: string, band: number) =>
      poly3(g, R(pts, 5.5 + dz), {color, band, layer: li, piece: p, flatShade: true, ew: 0});
    for (let k = 0; k < 4; k++) {
      const a = a0 + (k / 4) * Math.PI * 2;
      const pts: V2[] = [];
      for (let s = 0; s <= 8; s++) {
        const t = a - 0.62 + (s / 8) * 1.24;
        pts.push([cx + 25.5 * Math.cos(t), cy + 25.5 * Math.sin(t)]);
      }
      for (let s = 8; s >= 0; s--) {
        const t = a - 0.42 + (s / 8) * 0.84;
        pts.push([cx + 9.5 * Math.cos(t), cy + 9.5 * Math.sin(t)]);
      }
      top(ccw(pts), 0.05, C.tomatoGel, 1000);
      for (let s = 0; s < 3; s++) {
        const t = a - 0.36 + s * 0.36;
        const rr = 15 + (s % 2) * 4;
        top(ccw(ellipse(cx + rr * Math.cos(t), cy + rr * Math.sin(t), 1.9, 1.1, t, 8)), 0.1, C.tomatoSeed, 1001);
      }
    }
    top(ccw(circle(cx, cy, 6.5, 20)), 0.05, C.tomatoCore, 1000);
  });
});

// ---------- 02 laitue ----------
const lettuce = mk((g) => {
  const n = 132;
  const rr = (t: number) => 61 + 3.2 * Math.sin(7 * t + 0.5) + 1.8 * Math.sin(13 * t + 1.3) + 1.1 * Math.sin(23 * t + 0.2);
  const w = (t: number) => 2.6 * Math.sin(5 * t) + 1.3 * Math.sin(11 * t + 2);
  const at = (k: number, dz: number, amp: number): V3[] => Array.from({length: n}, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const r = rr(t) * k;
    return [r * Math.cos(t), r * Math.sin(t), dz + w(t) * amp];
  });
  const p = loft(g, [at(0.985, 0, 1), at(1, 2.2, 1), at(0.86, 3.4, 0.7), at(0.66, 4.2, 0.35), at(0.4, 4.6, 0.1)], {
    color: C.lettuceSide,
    topColor: C.lettuceIn,
    bandColor: (j) => (j === 0 ? C.lettuceSide : j === 1 ? C.lettuce : j === 2 ? C.lettuce : C.lettuceIn),
  });
  // nervures
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const pts: V2[] = [];
    const L0 = 6;
    const L1 = 50;
    const wdt = 1.1;
    for (let s = 0; s <= 6; s++) {
      const u = L0 + ((L1 - L0) * s) / 6;
      const bend = Math.sin(s * 0.5) * 3;
      pts.push([u, bend + wdt * (1 - s / 7)]);
    }
    for (let s = 6; s >= 0; s--) {
      const u = L0 + ((L1 - L0) * s) / 6;
      const bend = Math.sin(s * 0.5) * 3;
      pts.push([u, bend - wdt * (1 - s / 7)]);
    }
    decal(g, ccw(rot2(pts, a)), 4.8, C.lettuceVein, p);
  }
});

// ---------- 01 couronne ----------
const TOP_PROF: [number, number][] = [
  [54, 0], [55.6, 3], [56.4, 8], [56, 14], [54.2, 20], [50.8, 26.5], [45.6, 32.5], [38.5, 38], [29.5, 42.6], [19.5, 46], [9.5, 48.3], [3, 49],
];
const domeAt = (r: number): {z: number; n: [number, number]} => {
  for (let i = 4; i < TOP_PROF.length - 1; i++) {
    const [r0, z0] = TOP_PROF[i];
    const [r1, z1] = TOP_PROF[i + 1];
    if (r <= r0 && r >= r1) {
      const u = (r0 - r) / (r0 - r1);
      const dr = r1 - r0;
      const dz = z1 - z0;
      const l = Math.hypot(dr, dz);
      return {z: z0 + (z1 - z0) * u, n: [dz / l, -dr / l]};
    }
  }
  return {z: 49, n: [0, 1]};
};
const topBun = mk((g) => {
  const p = loft(g, TOP_PROF.map(([r, z]) => ring(circle(0, 0, r, 56), z)), {
    color: C.crust,
    topColor: C.crustTop,
    bandColor: (j) => (j < 2 ? C.crustHi : j < 3 ? C.crustMid : j < 8 ? C.crust : C.crustTop),
  });
  // graines de sésame, posées dans le plan tangent
  const R = rng(2026);
  const N = 46;
  for (let k = 0; k < N; k++) {
    const r = 47 * Math.sqrt((k + 0.6) / N);
    const t = k * 2.39996 + R() * 0.3;
    const {z, n} = domeAt(r);
    const c: V3 = [r * Math.cos(t), r * Math.sin(t), z];
    const nn: V3 = [n[0] * Math.cos(t), n[0] * Math.sin(t), n[1]];
    // base tangente
    const up: V3 = Math.abs(nn[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
    const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nz = (v: V3): V3 => {
      const l = Math.hypot(...v);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    let t1 = nz(cross(up, nn));
    let t2 = cross(nn, t1);
    const a = R() * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    [t1, t2] = [
      [t1[0] * ca + t2[0] * sa, t1[1] * ca + t2[1] * sa, t1[2] * ca + t2[2] * sa],
      [-t1[0] * sa + t2[0] * ca, -t1[1] * sa + t2[1] * ca, -t1[2] * sa + t2[2] * ca],
    ];
    const pts: V3[] = [];
    const m = 9;
    for (let s = 0; s < m; s++) {
      const th = (s / m) * Math.PI * 2;
      const ax = 2.1 * Math.cos(th) * (1 - 0.18 * Math.cos(th));
      const ay = 1.15 * Math.sin(th);
      pts.push([c[0] + t1[0] * ax + t2[0] * ay + nn[0] * 0.5, c[1] + t1[1] * ax + t2[1] * ay + nn[1] * 0.5, c[2] + t1[2] * ax + t2[2] * ay + nn[2] * 0.5]);
    }
    const f: Omit<Face, 'idx'> = {color: C.sesame, band: 1000, layer: 0, piece: p, flatShade: true, ew: 0.9, ec: C.sesameEdge};
    poly3(g, pts, f);
  }
});

const rim = (r: number, z: number): Anchor => ({kind: 'rim', r, z});

export const LAYERS: LayerDef[] = [
  {id: 'top', n: '01', name: 'Pain du dessus', grams: 45, detail: 'brioché, sésame', ...topBun, z0: 59.5, zx: 346, top: 49, side: 'L', anchor: rim(55.8, 12), spin: 18},
  {id: 'lettuce', n: '02', name: 'Laitue', grams: 12, detail: '1 feuille', ...lettuce, z0: 56.5, zx: 302, top: 4.6, side: 'R', anchor: rim(61, 2), spin: -24},
  {id: 'tomato', n: '03', name: 'Tomate', grams: 40, detail: '2 tranches', ...tomato, z0: 49.5, zx: 262, top: 7, side: 'L', anchor: {kind: 'pts', pts: []}, spin: 20},
  {id: 'onion', n: '04', name: 'Oignon rouge', grams: 15, detail: '4 rondelles', ...onion, z0: 46.5, zx: 222, top: 3, side: 'R', anchor: {kind: 'pts', pts: []}, spin: -22},
  {id: 'pickles', n: '05', name: 'Cornichons', grams: 15, detail: '4 tranches', ...pickles, z0: 43, zx: 182, top: 3.4, side: 'L', anchor: {kind: 'pts', pts: []}, spin: 26},
  {id: 'cheese', n: '06', name: 'Cheddar affiné', grams: 20, detail: '1 tranche', ...cheese, z0: 41, zx: 142, top: 2.5, side: 'R', anchor: rim(44, 1), spin: -16},
  {id: 'patty', n: '07', name: 'Steak haché', grams: 150, detail: 'bœuf, 15 % MG', ...patty, z0: 24.5, zx: 92, top: 16.5, side: 'L', anchor: rim(56.5, 8.5), spin: 14},
  {id: 'sauce', n: '08', name: 'Sauce maison', grams: 20, detail: 'mayo, paprika', ...sauce, z0: 22, zx: 54, top: 3, side: 'R', anchor: rim(44, 1.5), spin: -18},
  {id: 'bottom', n: '09', name: 'Pain du dessous', grams: 40, detail: 'brioché, toasté', ...bottomBun, z0: 0, zx: 0, top: 22, side: 'L', anchor: rim(55.3, 13), spin: 0},
];

// ancres posées sur une pièce précise (garnitures éparpillées)
const byId = (id: string) => LAYERS.find((l) => l.id === id)!;
(byId('tomato').anchor as {pts: V3[]}).pts = [[-44, 16, 4], [44, -14, 6]];
(byId('onion').anchor as {pts: V3[]}).pts = ONIONS.map(([x, y, r]) => [x + r - 2, y, 3] as V3);
(byId('pickles').anchor as {pts: V3[]}).pts = PICKLES.map(([x, y]) => [x - 12, y, 3.4] as V3);

export const TOTAL_GRAMS = LAYERS.reduce((s, l) => s + l.grams, 0);
