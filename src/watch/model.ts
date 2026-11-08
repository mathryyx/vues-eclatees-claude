// Montre mécanique générique à remontage manuel, cadran « cœur ouvert », modélisée à la main.
// Repère : x vers 3 h (couronne), y vers 12 h, z vers le haut (côté cadran).
// Unités ≈ pixels à l'échelle 1. Diamètre de boîte : 300.
import {V2, V3, Geo, Topo, Face, newGeo, loft, ring, circle, catmullClosed, ccw, inset, roundRect, buildTopo} from './engine';

export const C = {
  paper: '#F2EEE5',
  grid: '#E3DDD0',
  ink: '#1C2030',
  soft: '#8B8F9E',
  accent: '#F07A3A',
  steel: '#C9D0DC',
  steelDark: '#9DA7B8',
  glass: '#B9E2F2',
  dial: '#33489C',
  dialDeep: '#24357A',
  cream: '#F8F2E4',
  plate: '#DCE0E8',
  perlage: '#C3C9D4',
  bridge: '#B7C1D2',
  gold: '#E2AA3F',
  brass: '#D3953A',
  brassDeep: '#A8722A',
  ruby: '#D9364F',
  rubyLight: '#F48A9A',
  blued: '#2E428F',
  spring: '#2D3142',
  hairspring: '#2B3D8C',
  anchor: '#A3ADBF',
};

// ---------- implantation du mouvement ----------
export const POS = {
  barrel: [40, 62] as V2,
  center: [0, 0] as V2,
  third: [62, -30] as V2,
  fourth: [22, -74] as V2,
  escape: [-26, -86] as V2,
  balance: [-72, -48] as V2,
};
const dirEB = (() => {
  const dx = POS.balance[0] - POS.escape[0];
  const dy = POS.balance[1] - POS.escape[1];
  const l = Math.hypot(dx, dy);
  return [dx / l, dy / l] as V2;
})();
export const ANCHOR_PIVOT: V2 = [POS.escape[0] + dirEB[0] * 25, POS.escape[1] + dirEB[1] * 25];

// ouverture « cœur ouvert » (cadran) et creusure de la platine
const APERTURE_CTRL: V2[] = [
  [-112, -40], [-104, -14], [-76, -8], [-48, -22], [-30, -48], [-6, -72], [-4, -96], [-22, -110],
  [-50, -104], [-78, -92], [-98, -70],
];
export const APERTURE = ccw(catmullClosed(APERTURE_CTRL, 5));
const PLATE_HOLE = inset(APERTURE, -3);

export const pointInPoly = (p: V2, poly: V2[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// ---------- primitives ----------
interface PrismOpts {
  color: string;
  topColor?: string;
  holes?: V2[][];
  holeWalls?: boolean;
  layer?: number;
  piece?: number;
  opacity?: number;
}

/** Prisme droit d'un contour (trigo), avec trous éventuels sur les deux faces. */
const prism = (g: Geo, outline: V2[], z0: number, z1: number, o: PrismOpts): number => {
  const piece = o.piece ?? g.pieces++;
  const layer = o.layer ?? 0;
  const add = (pts: V2[], z: number) =>
    pts.map(([x, y]) => {
      g.verts.push([x, y, z]);
      return g.verts.length - 1;
    });
  const out = ccw(outline);
  const a = add(out, z0);
  const b = add(out, z1);
  const n = out.length;
  const op = o.opacity;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    g.faces.push({idx: [a[i], a[i2], b[i2], b[i]], color: o.color, band: 0, layer, piece, opacity: op});
  }
  const holes = (o.holes ?? []).map((h) => ccw(h));
  const h0 = holes.map((h) => add(h, z0));
  const h1 = holes.map((h) => add(h, z1));
  if (o.holeWalls) {
    holes.forEach((h, k) => {
      const m = h.length;
      const r0 = [...h0[k]].reverse();
      const r1 = [...h1[k]].reverse();
      for (let i = 0; i < m; i++) {
        const i2 = (i + 1) % m;
        g.faces.push({idx: [r0[i], r0[i2], r1[i2], r1[i]], color: o.color, band: 0, layer, piece});
      }
    });
  }
  const top: Face = {idx: b, color: o.topColor ?? o.color, band: 2, layer, piece, opacity: op};
  const bot: Face = {idx: [...a].reverse(), color: o.color, band: -1, layer, piece, opacity: op};
  if (holes.length) {
    top.holes = h1;
    bot.holes = h0;
  }
  g.faces.push(top, bot);
  return piece;
};

const flat = (g: Geo, poly: V2[], z: number, color: string, piece: number, layer = 0, band = 1000, opacity?: number, holes?: V2[][]) => {
  const add = (pts: V2[]) =>
    pts.map(([x, y]) => {
      g.verts.push([x, y, z]);
      return g.verts.length - 1;
    });
  const f: Face = {idx: add(ccw(poly)), color, band, layer, piece, flatShade: true, opacity, noEdge: true};
  if (holes) f.holes = holes.map((h) => add(h));
  g.faces.push(f);
};

const line3 = (g: Geo, pts: V3[], color: string, width: number, piece: number, layer = 0, band = 1001, closed = false, opacity?: number) => {
  const ids = pts.map((p) => {
    g.verts.push(p);
    return g.verts.length - 1;
  });
  g.faces.push({idx: ids, color, band, layer, piece, stroke: width, closed, opacity});
};

const polar = (cx: number, cy: number, r: number, a: number): V2 => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

/** Denture droite : n dents trapézoïdales. */
export const gear = (cx: number, cy: number, r0: number, r1: number, n: number, phase = 0): V2[] => {
  const pts: V2[] = [];
  const w = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    const a = phase + k * w;
    pts.push(polar(cx, cy, r0, a - 0.27 * w), polar(cx, cy, r1, a - 0.14 * w), polar(cx, cy, r1, a + 0.14 * w), polar(cx, cy, r0, a + 0.27 * w), polar(cx, cy, r0, a + 0.5 * w));
  }
  return pts;
};

/** Roue d'échappement à ancre suisse : 15 dents « en massue », inclinées. */
const clubGear = (cx: number, cy: number, r0: number, r1: number, n: number): V2[] => {
  const pts: V2[] = [];
  const w = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    const a = k * w;
    pts.push(polar(cx, cy, r0, a), polar(cx, cy, r1, a + 0.42 * w), polar(cx, cy, r1 - 0.6, a + 0.62 * w), polar(cx, cy, r0 + 2.2, a + 0.6 * w), polar(cx, cy, r0, a + 0.78 * w));
  }
  return pts;
};

/** Trous entre les bras d'une roue (croisillons). */
const spokeHoles = (cx: number, cy: number, rRim: number, rHub: number, n: number, w: number, phase = 0.3): V2[][] => {
  const holes: V2[][] = [];
  for (let s = 0; s < n; s++) {
    const a0 = phase + (s / n) * Math.PI * 2;
    const a1 = phase + ((s + 1) / n) * Math.PI * 2;
    const dO = w / 2 / rRim;
    const dI = w / 2 / rHub;
    const h: V2[] = [];
    const m = 10;
    for (let k = 0; k <= m; k++) h.push(polar(cx, cy, rRim, a0 + dO + ((a1 - a0 - 2 * dO) * k) / m));
    for (let k = 3; k >= 0; k--) h.push(polar(cx, cy, rHub, a0 + dI + ((a1 - a0 - 2 * dI) * k) / 3));
    holes.push(h);
  }
  return holes;
};

/** Contour épais autour d'une polyligne (ponts). */
const thick = (pts: V2[], w: number): V2[] => {
  const left: V2[] = [];
  const right: V2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  }
  const cap = (c: V2, from: V2): V2[] => {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    return Array.from({length: 7}, (_, k) => polar(c[0], c[1], w, a0 - (k / 6) * Math.PI));
  };
  return ccw([...left, ...cap(pts[n - 1], left[n - 1]).slice(1, -1), ...right.reverse(), ...cap(pts[0], right[right.length - 1]).slice(1, -1)]);
};

const spiralPts = (cx: number, cy: number, r0: number, r1: number, turns: number, z: number, a0 = 0, n = 220): V3[] =>
  Array.from({length: n + 1}, (_, k) => {
    const t = k / n;
    const r = r0 + (r1 - r0) * t;
    const a = a0 + t * turns * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  });

const ringPts = (cx: number, cy: number, r: number, z: number, n = 64): V3[] => circle(cx, cy, r, n).map(([x, y]) => [x, y, z]);

const rubyAt = (g: Geo, x: number, y: number, z: number, piece: number, r = 4.2) => {
  flat(g, circle(x, y, r, 18), z, C.ruby, piece, 0, 1002);
  flat(g, circle(x - r * 0.25, y + r * 0.25, r * 0.38, 10), z, C.rubyLight, piece, 0, 1003);
};

const screwAt = (g: Geo, x: number, y: number, z: number, piece: number, a = 0.6) => {
  flat(g, circle(x, y, 5, 18), z, C.blued, piece, 0, 1002);
  line3(g, [[x - 4 * Math.cos(a), y - 4 * Math.sin(a), z], [x + 4 * Math.cos(a), y + 4 * Math.sin(a), z]], '#C9D6FF', 1.4, piece, 0, 1003);
};

// ---------- pièces ----------
export type Role = 'static' | 'barrel' | 'center' | 'third' | 'fourth' | 'escape' | 'anchor' | 'balance' | 'hour' | 'minute' | 'second';

export interface PartDef {
  id: string;
  geo: Geo;
  topo: Topo;
  explode: V3;
  pieceExplode: V3[]; // supplément par pièce
  roles: Role[]; // rôle de chaque pièce (rotation)
  zRef: number; // altitude de tri (assemblé)
  pivot: V2;
}

const mk = (
  id: string,
  build: (g: Geo, roles: Role[], pex: V3[]) => void,
  explode: V3,
  zRef: number,
  pivot: V2 = [0, 0],
): PartDef => {
  const g = newGeo();
  const roles: Role[] = [];
  const pex: V3[] = [];
  build(g, roles, pex);
  for (let i = 0; i < g.pieces; i++) {
    roles[i] = roles[i] ?? 'static';
    pex[i] = pex[i] ?? [0, 0, 0];
  }
  return {id, geo: g, topo: buildTopo(g), explode, pieceExplode: pex, roles, zRef, pivot};
};

// --- glace saphir (z 18 → 22)
const glass = mk('glass', (g) => {
  const p = loft(g, [ring(circle(0, 0, 134, 72), 18), ring(circle(0, 0, 134, 72), 20.5), ring(circle(0, 0, 130, 72), 22)], {color: C.glass});
  g.faces.forEach((f) => (f.opacity = 0.34));
  const strip = (a: number, w: number, r: number): V2[] => {
    const pts: V2[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = -1 + (2 * k) / 8;
      pts.push([Math.cos(a) * r * t - Math.sin(a) * (-w / 2), Math.sin(a) * r * t + Math.cos(a) * (-w / 2)]);
    }
    for (let k = 8; k >= 0; k--) {
      const t = -1 + (2 * k) / 8;
      pts.push([Math.cos(a) * r * t - Math.sin(a) * (w / 2), Math.sin(a) * r * t + Math.cos(a) * (w / 2)]);
    }
    return pts.map(([x, y]) => [x - 34, y + 30] as V2);
  };
  flat(g, strip(-0.75, 8, 34).map(([x, y]) => [x - 26, y + 30] as V2), 22.2, '#FFFFFF', p, 0, 1000, 0.45);
  flat(g, strip(-0.75, 3.5, 24).map(([x, y]) => [x - 6, y + 50] as V2), 22.2, '#FFFFFF', p, 0, 1001, 0.45);
}, [0, 0, 760], 18.6);

// --- boîte : carrure + lunette + cornes (z -22 → 18)
const CASE_IN = 133;
const caseOuter = mk('caseOuter', (g) => {
  const prof: [number, number][] = [[145, -22], [150, -17], [150, 11], [148, 15], [143, 18]];
  const rings = prof.map(([r, z]) => ring(circle(0, 0, r, 96), z));
  const p = loft(g, rings, {color: C.steel, capTop: false, capBottom: false});
  // anneau supérieur (lunette) troué
  const addRing = (r: number, z: number) =>
    circle(0, 0, r, 96).map(([x, y]) => {
      g.verts.push([x, y, z]);
      return g.verts.length - 1;
    });
  // réutiliser les sommets du dernier anneau du loft : on recrée le même contour
  const top = addRing(143, 18);
  const hole = addRing(CASE_IN, 18);
  g.faces.push({idx: top, holes: [hole], color: C.steel, band: 10, layer: 0, piece: p});
  const bot = addRing(145, -22).reverse();
  const bh = addRing(CASE_IN, -22);
  g.faces.push({idx: bot, holes: [bh], color: C.steel, band: -1, layer: 0, piece: p});
  // cornes avant (les cornes arrière sont une pièce à part, dessinée derrière la carrure)
  for (const sx of [-1, 1]) {
    for (const sy of [-1]) {
      const rr = roundRect(sx * 70, sy * 166, 24, 56, 7, 3);
      loft(g, [ring(rr, -12), ring(rr, 6), ring(inset(rr, 3), 9)], {color: C.steel, layer: 0});
    }
  }
}, [0, 0, 640], 18);

const caseLugs = mk('caseLugs', (g) => {
  for (const sx of [-1, 1]) {
    const rr = roundRect(sx * 70, 166, 24, 56, 7, 3);
    loft(g, [ring(rr, -12), ring(rr, 6), ring(inset(rr, 3), 9)], {color: C.steel});
  }
}, [0, 0, 640], -22);

const caseInner = mk('caseInner', (g) => {
  const pts = circle(0, 0, CASE_IN, 96).reverse();
  loft(g, [ring(pts, -22), ring(pts, 18)], {color: C.steelDark, capTop: false, capBottom: false});
}, [0, 0, 640], -22);

// --- couronne (sur l'axe x, à 3 h)
const crown = mk('crown', (g, roles) => {
  void roles;
  const o = {axis: 'x' as const};
  const knurl = gear(0, -2, 10.2, 11.4, 22);
  const p = loft(g, [ring(circle(0, -2, 4, 16), 143), ring(circle(0, -2, 4, 16), 153)], {color: C.steelDark, ...o});
  void p;
  loft(g, [ring(gear(0, -2, 8.4, 9.4, 22), 152), ring(knurl, 154.5), ring(knurl, 171), ring(gear(0, -2, 8.8, 9.8, 22), 174)], {color: C.steel, ...o});
}, [30, 0, 640], 18.3);

// --- aiguilles
const HANDS_Z = {hour: 7.5, minute: 9.5, second: 11.5};
const hands = mk('hands', (g, roles, pex) => {
  const handPiece = (body: V2[], hubR: number, z: number, col: string, role: Role, layer: number, extra?: (p: number) => void) => {
    const p = loft(g, [ring(ccw(body), z), ring(ccw(body), z + 1.4)], {color: col, layer});
    loft(g, [ring(circle(0, 0, hubR, 20), z), ring(circle(0, 0, hubR, 20), z + 1.6)], {color: col, layer: layer + 1, piece: p});
    roles[p] = role;
    extra?.(p);
    return p;
  };
  const ph = handPiece([[-5.5, -12], [5.5, -12], [4.5, 46], [0, 62], [-4.5, 46]], 8.5, HANDS_Z.hour, C.cream, 'hour', 0);
  const pm = handPiece([[-4.2, -16], [4.2, -16], [3.2, 96], [0, 106], [-3.2, 96]], 7, HANDS_Z.minute, C.cream, 'minute', 2);
  const ps = handPiece([[-1.5, -30], [1.5, -30], [0.9, 116], [-0.9, 116]], 4.2, HANDS_Z.second, C.accent, 'second', 4, (p) => {
    loft(g, [ring(circle(0, -24, 5.5, 18), HANDS_Z.second), ring(circle(0, -24, 5.5, 18), HANDS_Z.second + 1.4)], {color: C.accent, layer: 5, piece: p});
  });
  // repères sombres sur les aiguilles (lumineux stylisés)
  flat(g, ccw([[-2, 8], [2, 8], [1.6, 44], [-1.6, 44]]), HANDS_Z.hour + 1.45, C.dialDeep, ph, 0, 1000);
  flat(g, ccw([[-1.5, 10], [1.5, 10], [1.1, 92], [-1.1, 92]]), HANDS_Z.minute + 1.45, C.dialDeep, pm, 2, 1000);
  pex[ph] = [0, 0, 0];
  pex[pm] = [0, 0, 26];
  pex[ps] = [0, 0, 52];
}, [0, 0, 430], 7.5);

// --- cadran (z 4 → 6.5), cœur ouvert
const dial = mk('dial', (g) => {
  const p = prism(g, circle(0, 0, 131, 96), 4, 6.5, {color: C.dial, holes: [APERTURE]});
  const z = 6.6;
  // biseau doré autour de l'ouverture
  line3(g, APERTURE.map(([x, y]) => [x, y, z] as V3), C.gold, 3, p, 0, 1001, true);
  // minuterie : traits hors de l'ouverture
  for (let k = 0; k < 60; k++) {
    if (k % 5 === 0) continue;
    const a = Math.PI / 2 - (k / 60) * Math.PI * 2;
    const p0 = polar(0, 0, 119, a);
    const p1 = polar(0, 0, 125, a);
    if (pointInPoly(polar(0, 0, 122, a), inset(APERTURE, -8))) continue;
    line3(g, [[p0[0], p0[1], z], [p1[0], p1[1], z]], '#B9C3EA', 1.1, p, 0, 1001);
  }
  // index appliqués (7 h et 8 h remplacés par l'ouverture)
  for (let h = 0; h < 12; h++) {
    if (h === 7 || h === 8) continue;
    const a = Math.PI / 2 - (h / 12) * Math.PI * 2;
    const bars = h === 0 ? [-5.5, 5.5] : [0];
    for (const off of bars) {
      const len = h % 3 === 0 ? 20 : 15;
      const w = h % 3 === 0 ? 6 : 5;
      const rc = 124 - len / 2;
      const c = polar(0, 0, rc, a);
      const t: V2 = [Math.cos(a), Math.sin(a)];
      const nrm: V2 = [-t[1], t[0]];
      const cx = c[0] + nrm[0] * off;
      const cy = c[1] + nrm[1] * off;
      const quad: V2[] = [
        [cx - t[0] * len / 2 - nrm[0] * w / 2, cy - t[1] * len / 2 - nrm[1] * w / 2],
        [cx + t[0] * len / 2 - nrm[0] * w / 2, cy + t[1] * len / 2 - nrm[1] * w / 2],
        [cx + t[0] * len / 2 + nrm[0] * w / 2, cy + t[1] * len / 2 + nrm[1] * w / 2],
        [cx - t[0] * len / 2 + nrm[0] * w / 2, cy - t[1] * len / 2 + nrm[1] * w / 2],
      ];
      prism(g, quad, 6.5, 8, {color: C.cream, layer: 1});
    }
  }
}, [0, 0, 350], 4);

// --- platine (z -2 → 4), creusure du balancier, perlage
const plate = mk('plate', (g) => {
  const p = prism(g, circle(0, 0, 128, 96), -2, 4, {color: C.plate, holes: [PLATE_HOLE], holeWalls: true});
  const z = 4.1;
  // perlage : cercles qui se chevauchent
  const avoid = inset(PLATE_HOLE, -6);
  for (let y = -112; y <= 112; y += 15) {
    for (let x = -112; x <= 112; x += 15) {
      const xx = x + ((y / 15) % 2 ? 7.5 : 0);
      if (Math.hypot(xx, y) > 112) continue;
      if (pointInPoly([xx, y], avoid)) continue;
      line3(g, ringPts(xx, y, 8, z, 16), C.perlage, 1, p, 0, 1000, true);
    }
  }
  for (const [x, y] of [POS.center, POS.third, POS.fourth, POS.escape, ANCHOR_PIVOT]) rubyAt(g, x, y, z + 0.1, p);
  for (const [x, y] of [[-30, 96], [96, 40], [70, -84]] as V2[]) screwAt(g, x, y, z + 0.1, p);
}, [0, 0, 262], -2);

// --- barillet ouvert : tambour denté, ressort spiral, arbre
const barrel = mk('barrel', (g, roles) => {
  const [x, y] = POS.barrel;
  const floor = prism(g, circle(x, y, 38, 48), -13, -12, {color: C.brassDeep, layer: 0});
  line3(g, spiralPts(x, y, 9, 35, 7.2, -11.8, 0.4), C.spring, 1.6, floor, 0, 1001);
  const drum = prism(g, gear(x, y, 42, 45.5, 60), -14, -4, {color: C.brass, holes: [circle(x, y, 37, 48)], holeWalls: true, layer: 1});
  const arbor = prism(g, circle(x, y, 7, 18), -13, -3, {color: C.steel, layer: 2});
  flat(g, roundRect(x, y, 6, 6, 0.8, 1), -2.9, C.spring, arbor, 2, 1001);
  roles[floor] = 'barrel';
  roles[drum] = 'barrel';
  roles[arbor] = 'barrel';
}, [58, -18, 150], -14, POS.barrel);

// --- rouage : roue de centre, roue moyenne, roue de secondes
const wheel = (g: Geo, c: V2, r0: number, r1: number, nT: number, nS: number, z0: number, z1: number, col: string, layer: number) => {
  const rim = r0 - 4.5;
  const hub = Math.max(5.5, r0 * 0.24);
  const p = prism(g, gear(c[0], c[1], r0, r1, nT), z0, z1, {color: col, holes: spokeHoles(c[0], c[1], rim, hub, nS, 4), layer});
  prism(g, gear(c[0], c[1], 3.4, 5.4, 8), z0 - 4, z1 + 3, {color: C.steel, layer: layer + 1, piece: p});
  return p;
};
const train = mk('train', (g, roles, pex) => {
  const pc = wheel(g, POS.center, 33, 36.5, 48, 4, -8, -6, C.gold, 0);
  const pt = wheel(g, POS.third, 27, 30.5, 40, 4, -11, -9, C.gold, 2);
  const pf = wheel(g, POS.fourth, 24, 27.5, 36, 4, -12.5, -10.5, C.gold, 4);
  roles[pc] = 'center';
  roles[pt] = 'third';
  roles[pf] = 'fourth';
  pex[pc] = [0, 0, 112];
  pex[pt] = [0, 0, 136];
  pex[pf] = [0, 0, 92];
}, [0, 0, 0], -12.5);

// --- roue d'échappement (acier, 15 dents)
const escape = mk('escape', (g, roles) => {
  const [x, y] = POS.escape;
  const p = prism(g, clubGear(x, y, 11.5, 18, 15), -10, -8.5, {color: C.anchor, holes: spokeHoles(x, y, 8.6, 3.8, 5, 2.2)});
  prism(g, gear(x, y, 2.4, 3.8, 7), -14, -6, {color: C.steel, layer: 1, piece: p});
  roles[p] = 'escape';
}, [0, 0, 128], -10, POS.escape);

// --- ancre suisse, palettes en rubis
const ANCHOR_LOCAL: V2[] = [
  [32, -5], [32, -1.8], [28, -1.8], [28, 1.8], [32, 1.8], [32, 5], [25, 5], [24, 2.6], [4, 2.6], [-2, 7.5], [-10, 16.5],
  [-17, 16], [-15, 11], [-7.5, 3.6], [-7.5, -3.6], [-15, -11], [-17, -16], [-10, -16.5], [-2, -7.5], [4, -2.6], [24, -2.6], [25, -5],
];
export const anchorToWorld = ([u, v]: V2): V2 => {
  const d = dirEB;
  const n: V2 = [-d[1], d[0]];
  return [ANCHOR_PIVOT[0] + u * d[0] + v * n[0], ANCHOR_PIVOT[1] + u * d[1] + v * n[1]];
};
const anchor = mk('anchor', (g, roles) => {
  const p = prism(g, ANCHOR_LOCAL.map(anchorToWorld), -8.8, -7.4, {color: C.anchor});
  for (const s of [1, -1]) {
    const q: V2[] = [[-18, 13.5 * s], [-14, 12 * s], [-12.5, 16 * s], [-16.5, 17.5 * s]].map((pt) => anchorToWorld(pt as V2));
    prism(g, q, -8.8, -7.0, {color: C.ruby, layer: 1, piece: p});
  }
  flat(g, circle(ANCHOR_PIVOT[0], ANCHOR_PIVOT[1], 3, 12), -7.3, C.steelDark, p, 0, 1001);
  roles[p] = 'anchor';
}, [0, 0, 158], -8.8, ANCHOR_PIVOT);

// --- balancier (le spiral est dessiné à part : il « respire »)
export const BAL_R = 31;
export const BAL_Z_TOP = -6.6;
const balance = mk('balance', (g, roles) => {
  const [x, y] = POS.balance;
  const p = prism(g, circle(x, y, BAL_R, 48), -10, -6.6, {color: C.gold, holes: spokeHoles(x, y, 26, 5, 3, 3.6, 0.5)});
  prism(g, circle(x, y, 3, 12), -12, -4.5, {color: C.steel, layer: 1, piece: p});
  roles[p] = 'balance';
}, [-34, 6, 190], -10, POS.balance);

// --- ponts (z -21 → -15), rubis, vis bleuies
const COQ = ccw(catmullClosed([[-61, -40], [-66, -59], [-97, -84], [-115, -57], [-79, -37]], 6));
const ponts = mk('ponts', (g) => {
  const z0 = -21;
  const z1 = -15;
  const zt = z1 + 0.1;
  const pb = prism(g, ccw(catmullClosed([[-8, 70], [10, 100], [50, 112], [92, 86], [104, 52], [80, 30], [40, 22], [8, 38]], 6)), z0, z1, {color: C.bridge});
  const pr = prism(g, thick([[-14, 10], POS.center, POS.third, POS.fourth, [8, -104]], 11), z0, z1, {color: C.bridge});
  const pe = prism(g, thick([POS.escape, ANCHOR_PIVOT, [-66, -100]], 9), z0, z1, {color: C.bridge});
  const pc = prism(g, COQ, z0, z1, {color: C.bridge});
  rubyAt(g, POS.barrel[0], POS.barrel[1], zt, pb, 6);
  for (const [x, y] of [POS.center, POS.third, POS.fourth]) rubyAt(g, x, y, zt, pr);
  for (const [x, y] of [POS.escape, ANCHOR_PIVOT]) rubyAt(g, x, y, zt, pe, 3.6);
  rubyAt(g, POS.balance[0], POS.balance[1], zt, pc, 4.6);
  flat(g, circle(POS.balance[0], POS.balance[1], 8, 20), zt, '#A9B3C4', pc, 0, 1001);
  screwAt(g, 76, 94, zt, pb);
  screwAt(g, 12, 46, zt, pb, 1.4);
  screwAt(g, -12, 10, zt, pr, 0.2);
  screwAt(g, 8, -104, zt, pr, 1.1);
  screwAt(g, -66, -100, zt, pe, 2.2);
  screwAt(g, -100, -66, zt, pc, 0.9);
}, [0, 0, -40], -21);

// --- fond vissé (z -30 → -22)
const fond = mk('fond', (g) => {
  const p = loft(g, [ring(circle(0, 0, 138, 96), -30), ring(circle(0, 0, 144, 96), -27), ring(circle(0, 0, 144, 96), -22)], {color: C.steel});
  line3(g, ringPts(0, 0, 134, -21.9, 96), C.steelDark, 1.4, p, 0, 1001, true);
  line3(g, ringPts(0, 0, 128, -21.9, 96), C.steelDark, 1.4, p, 0, 1001, true);
  line3(g, ringPts(0, 0, 122, -21.9, 96), C.steelDark, 1.4, p, 0, 1001, true);
  line3(g, ringPts(0, 0, 60, -21.9, 64), C.steelDark, 1.2, p, 0, 1001, true);
}, [0, 0, -150], -30);

export const PARTS = {glass, caseOuter, caseLugs, caseInner, crown, hands, dial, plate, barrel, train, escape, anchor, balance, ponts, fond};
export type PartKey = keyof typeof PARTS;
export {HANDS_Z, COQ, CASE_IN};
