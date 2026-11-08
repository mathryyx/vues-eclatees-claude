// Carte graphique générique (aucune marque), modélisée à la main.
// Unités ≈ pixels à l'échelle 1. Repère : x = longueur de la carte (équerre à gauche),
// y = hauteur de la carte (connecteur PCIe devant, y négatif), z = épaisseur (refroidissement en haut).
import {
  V2, V3, Geo, Topo, newGeo, loft, decal, ring, circle, catmullClosed, ccw, inset, roundRect, buildTopo, facePoly, tube,
} from './engine';

export const C = {
  paper: '#F2EEE5',
  grid: '#E3DDD0',
  ink: '#1C2030',
  soft: '#8B8F9E',
  accent: '#F07A3A',
  shroud: '#5A72DF',
  shroudRim: '#4A61CC',
  hole: '#252C55',
  fan: '#343A50',
  hub: '#2A2F42',
  alu: '#CDD2DC',
  copper: '#DB8C52',
  copperLight: '#EBA872',
  paste: '#AEB4C1',
  pcb: '#2F9672',
  trace: '#5DB894',
  gold: '#EBBB4B',
  chip: '#272B37',
  substrate: '#2E3448',
  die: '#8088A3',
  choke: '#C3C8D2',
  cap: '#3B4560',
  metal: '#C6CBD4',
  bracket: '#B7BDC9',
  back: '#4558C0',
  backDark: '#33439E',
  light: '#E4EAFF',
};

export interface PartDef {
  id: string;
  geo: Geo;
  topo: Topo;
  explode: V3;
  center: V3;
  wobble?: {axis: 'x' | 'y' | 'z'; deg: number};
  groups: Record<string, number[]>; // pièces internes nommées
}

const mk = (id: string, build: (g: Geo, groups: Record<string, number[]>) => void, explode: V3, center: V3, wobble?: PartDef['wobble']): PartDef => {
  const g = newGeo();
  const groups: Record<string, number[]> = {};
  build(g, groups);
  return {id, geo: g, topo: buildTopo(g), explode, center, wobble, groups};
};

const box = (g: Geo, cx: number, cy: number, w: number, h: number, z0: number, z1: number, color: string, layer = 0, r = 1.5, top?: string) =>
  loft(g, [ring(ccw(roundRect(cx, cy, w, h, r, 1)), z0), ring(ccw(roundRect(cx, cy, w, h, r, 1)), z1)], {color, layer, topColor: top});

const cyl = (g: Geo, cx: number, cy: number, profile: [number, number][], color: string, top?: string, n = 28, layer = 0) =>
  loft(g, profile.map(([r, z]) => ring(circle(cx, cy, r, n), z)), {color, topColor: top, layer});

const trace = (g: Geo, piece: number, z: number, pts: V2[], w = 1.8, color = C.trace) => {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    const nx = (-(y1 - y0) / L) * w;
    const ny = ((x1 - x0) / L) * w;
    decal(g, ccw([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]), z, color, piece, 0, 999);
  }
};

// ---------- implantation ----------
export const GPU_C: V2 = [-40, 0];
export const FAN_C: V2[] = [[-168, 0], [10, 0], [188, 0]];
const FAN_R = 78;
const SHROUD_TOP = 77;

// ---------- 01 ventilateurs ----------
export const fanOfPiece: number[] = [];
const fans = mk('fans', (g) => {
  FAN_C.forEach(([cx, cy], fi) => {
    const NB = 9;
    for (let b = 0; b < NB; b++) {
      const a0 = (b / NB) * Math.PI * 2;
      const pts: V2[] = [];
      const tv: number[] = [];
      const n = 7;
      const R0 = 23;
      for (let k = 0; k <= n; k++) {
        const s = k / n;
        const r = R0 + (FAN_R - R0) * s;
        const a = a0 - 0.3 + 0.44 * Math.pow(s, 1.2);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        tv.push(-1);
      }
      for (let k = 1; k < 4; k++) {
        const u = k / 4;
        const a = a0 + 0.14 + (0.69 - 0.14) * u;
        const r = FAN_R + 1.5 * Math.sin(Math.PI * u);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        tv.push(-1 + 2 * u);
      }
      for (let k = n; k >= 0; k--) {
        const s = k / n;
        const r = R0 + (FAN_R - R0) * s;
        const a = a0 + 0.3 + 0.39 * Math.pow(s, 1.4);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        tv.push(1);
      }
      // garde l'ordre trigo (il l'est par construction)
      const base = g.verts.length;
      const piece = loft(g, [ring(pts, SHROUD_TOP - 5), ring(pts, SHROUD_TOP - 2)], {color: C.fan});
      fanOfPiece[piece] = fi;
      // vrillage : bord d'attaque plus haut que le bord de fuite
      for (let k = 0; k < pts.length; k++) {
        g.verts[base + k][2] += 2.6 * tv[k];
        g.verts[base + pts.length + k][2] += 2.6 * tv[k];
      }
    }
    const hp = cyl(g, cx, cy, [[23, SHROUD_TOP - 7], [23, SHROUD_TOP + 1], [20, SHROUD_TOP + 3]], C.hub, undefined, 30, 1);
    fanOfPiece[hp] = fi;
    decal(g, circle(cx, cy, 13, 26), SHROUD_TOP + 3.2, '#3E4560', hp, 1);
    decal(g, circle(cx + 9, cy, 2.6, 10), SHROUD_TOP + 3.3, C.accent, hp, 1, 1001);
  });
}, [0, 0, 800], [10, 0, SHROUD_TOP]);

// ---------- 02 carénage ----------
const SHROUD_O = ccw(roundRect(10, 0, 540, 206, 18, 5));
const shroud = mk('shroud', (g) => {
  const p = loft(g, [ring(inset(SHROUD_O, 4), 52), ring(SHROUD_O, 57), ring(SHROUD_O, 71), ring(inset(SHROUD_O, 7), SHROUD_TOP)], {color: C.shroud});
  const z = SHROUD_TOP + 0.2;
  for (const [x, y] of FAN_C) {
    decal(g, circle(x, y, FAN_R + 9, 44), z, C.shroudRim, p);
    decal(g, circle(x, y, FAN_R + 4, 44), z, C.hole, p, 0, 1001);
  }
  // bandes d'accent, entre les ouvertures
  for (const x of [-79, 99]) {
    decal(g, ccw(roundRect(x, -78, 8, 34, 3, 2)), z, C.accent, p);
    decal(g, ccw(roundRect(x, 78, 8, 34, 3, 2)), z, C.light, p);
  }
}, [0, 0, 620], [10, 0, 64], {axis: 'x', deg: 6});

// ---------- 03 radiateur à ailettes ----------
const FIN_X0 = -248;
const FIN_X1 = 268;
const NFINS = 34;
const fins = mk('fins', (g) => {
  for (let i = 0; i < NFINS; i++) {
    const x = FIN_X0 + (i * (FIN_X1 - FIN_X0)) / (NFINS - 1);
    const r: V2[] = ccw([[x - 1.3, -92], [x + 1.3, -92], [x + 1.3, 92], [x - 1.3, 92]]);
    loft(g, [ring(r, 22), ring(r, 57)], {color: C.alu});
  }
}, [0, 0, 430], [10, 0, 40], {axis: 'x', deg: -4});

// ---------- 04 caloducs ----------
export const PIPE_Y = [-30, -10, 10, 30];
const PIPE_R = 6;
const pipes = mk('pipes', (g) => {
  PIPE_Y.forEach((y, i) => {
    const zL = i % 2 ? 50 : 42;
    const zR = i % 2 ? 42 : 50;
    const zB = 20 + PIPE_R;
    const zAt = (x: number) => {
      const sm = (a: number, b: number, v: number) => {
        const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
        return t * t * (3 - 2 * t);
      };
      if (x < -40) return zL + (zB - zL) * sm(-140 + i * 6, -86, x);
      return zB + (zR - zB) * sm(6, 60 + i * 8, x);
    };
    const xs: number[] = [];
    for (let x = FIN_X0 - 2; x < -150; x += 30) xs.push(x);
    for (let x = -150; x <= 100; x += 6) xs.push(x);
    for (let x = 130; x <= FIN_X1 + 2; x += 30) xs.push(x);
    if (xs[xs.length - 1] < FIN_X1 + 2) xs.push(FIN_X1 + 2);
    const path: V3[] = xs.map((x) => [x, y, zAt(x)]);
    tube(g, path, PIPE_R, [0, 1, 0], {color: C.copperLight}, 12);
  });
}, [0, 0, 280], [10, 0, 36]);

// ---------- 05 plaque de contact ----------
const plate = mk('plate', (g) => {
  const r = ccw(roundRect(GPU_C[0], GPU_C[1], 80, 80, 5, 2));
  const p = loft(g, [ring(r, 11), ring(r, 18), ring(inset(r, 2.5), 20)], {color: C.copper});
  for (const y of PIPE_Y) decal(g, ccw(roundRect(GPU_C[0], y, 70, 9, 4, 2)), 20.2, C.copperLight, p);
}, [0, 0, 175], [GPU_C[0], 0, 15]);

// ---------- 06 pâte thermique ----------
const paste = mk('paste', (g) => {
  const jit = [1, 0.86, 1.04, 0.9, 1.06, 0.84, 1.0, 0.92];
  const ctrl: V2[] = jit.map((k, i) => {
    const a = (i / jit.length) * Math.PI * 2 + 0.3;
    return [GPU_C[0] + 25 * k * Math.cos(a), GPU_C[1] + 25 * k * Math.sin(a)];
  });
  const out = ccw(catmullClosed(ctrl, 5));
  const p = loft(g, [ring(out, 9.5), ring(inset(out, 1.5), 11.5)], {color: C.paste});
  decal(g, ccw(catmullClosed(ctrl.map(([x, y]) => [GPU_C[0] + (x - GPU_C[0]) * 0.45 - 4, GPU_C[1] + (y - GPU_C[1]) * 0.35 + 5] as V2), 4)), 11.7, '#C3C8D3', p);
}, [0, 0, 90], [GPU_C[0], 0, 10]);

// ---------- circuit imprimé et composants ----------
export const PCB_OUT: V2[] = ccw([
  [-258, -100], [-196, -100], [-196, -113], [-176, -113], [-176, -100], [-171, -100], [-171, -113], [-40, -113], [-40, -100],
  [200, -100], [200, 100], [-258, 100],
]);
const pcb = mk('pcb', (g, G) => {
  const board = loft(g, [ring(PCB_OUT, 0), ring(PCB_OUT, 4)], {color: C.pcb});
  G.board = [board];
  const z = 4.2;
  // trous de fixation du refroidisseur
  for (const [dx, dy] of [[-60, -60], [60, -60], [-60, 60], [60, 60]]) {
    decal(g, circle(GPU_C[0] + dx, GPU_C[1] + dy, 6, 18), z, C.gold, board);
    decal(g, circle(GPU_C[0] + dx, GPU_C[1] + dy, 3, 12), z, '#1E5E48', board, 0, 1001);
  }
  // pistes
  trace(g, board, z, [[-40, 43], [-40, 52], [-66, 52], [-66, 56]]);
  trace(g, board, z, [[-30, 43], [-30, 50], [-14, 50], [-14, 56]]);
  trace(g, board, z, [[-40, -43], [-40, -52], [-66, -52], [-66, -56]]);
  trace(g, board, z, [[-30, -43], [-30, -50], [-14, -50], [-14, -56]]);
  trace(g, board, z, [[-83, -12], [-99, -12], [-99, -26]]);
  trace(g, board, z, [[-83, 12], [-99, 12], [-99, 26]]);
  trace(g, board, z, [[3, -12], [19, -12], [19, -26]]);
  trace(g, board, z, [[3, 12], [19, 12], [19, 26]]);
  trace(g, board, z, [[-150, -100], [-150, -80], [-120, -80], [-100, -60]]);
  trace(g, board, z, [[-110, -100], [-110, -86], [-84, -86]]);
  trace(g, board, z, [[140, 72], [140, 20], [118, 20]]);
  trace(g, board, z, [[160, 72], [160, -60], [118, -60]]);
  trace(g, board, z, [[-200, 60], [-236, 60], [-236, 46]]);
  trace(g, board, z, [[-200, 30], [-226, 10]]);
  // petits composants passifs
  for (const [x, y] of [[-180, 70], [-170, 70], [-160, 70], [-190, -40], [-190, -30], [-150, 30], [170, -80], [180, -80], [60, 82], [70, 82]] as V2[]) {
    decal(g, ccw(roundRect(x, y, 6, 3.5, 0.8, 1)), z, '#C9CED8', board, 0, 1001);
  }

  // puce graphique
  const sub = box(g, GPU_C[0], GPU_C[1], 86, 86, 4, 6, C.substrate, 1, 2);
  const die = box(g, GPU_C[0], GPU_C[1], 52, 52, 6, 9.5, C.die, 2, 1.5);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    decal(g, ccw(roundRect(GPU_C[0] + 36 * Math.sign(Math.cos(a)) * Math.min(1, Math.abs(Math.cos(a)) * 1.6), GPU_C[1] + 36 * Math.sign(Math.sin(a)) * Math.min(1, Math.abs(Math.sin(a)) * 1.6), 4, 3, 0.6, 1)), 6.2, C.gold, sub, 1);
  }
  G.gpu = [sub, die];

  // mémoire vidéo (8 puces autour du GPU)
  const vram: number[] = [];
  const mem = (x: number, y: number, w: number, h: number) => {
    const p = box(g, x, y, w, h, 4, 7, C.chip, 1, 1);
    decal(g, circle(x - w / 2 + 4, y + h / 2 - 4, 1.6, 8), 7.2, '#6B7085', p, 1);
    vram.push(p);
  };
  for (const x of [-66, -14]) {
    mem(x, 67, 26, 22);
    mem(x, -67, 26, 22);
  }
  for (const y of [-26, 26]) {
    mem(-110, y, 22, 26);
    mem(30, y, 22, 26);
  }
  G.vram = vram;

  // étages d'alimentation : bobines, transistors de puissance, condensateurs
  const vrm: number[] = [];
  for (const y of [-66, -40, -14, 12, 38, 64]) {
    const ch = box(g, 80, y, 20, 20, 4, 15, C.choke, 1, 2);
    decal(g, ccw(roundRect(80, y, 12, 12, 2, 1)), 15.2, '#A9AFBC', ch, 1);
    vrm.push(ch);
    vrm.push(box(g, 104, y, 13, 15, 4, 6.5, C.chip, 1, 1));
  }
  for (const y of [-58, -32, -6, 20, 46]) {
    vrm.push(cyl(g, 126, y, [[6.5, 4], [6.5, 14]], C.cap, C.metal, 18, 1));
  }
  G.vrm = vrm;

  // connecteur PCIe : contacts dorés sur la languette
  const fing = loft(g, [ring(ccw([[-194, -112], [-42, -112], [-42, -101], [-194, -101]]), 4), ring(ccw([[-194, -112], [-42, -112], [-42, -101], [-194, -101]]), 4.4)], {color: C.pcb, layer: 1});
  for (let x = -193; x < -42; x += 4.6) {
    if (x > -178 && x < -169) continue;
    decal(g, ccw([[x, -112], [x + 2.6, -112], [x + 2.6, -102], [x, -102]]), 4.6, C.gold, fing, 1);
  }
  G.pcie = [fing];

  // connecteur d'alimentation (bord supérieur de la carte)
  const pw = box(g, 150, 84, 50, 18, 4, 21, C.chip, 1, 2);
  decal(g, ccw(roundRect(150, 79, 40, 4, 1.5, 1)), 21.2, '#4A5068', pw, 1);
  for (let k = 0; k < 6; k++) decal(g, ccw(roundRect(132 + k * 7.2, 88, 4.4, 4.4, 0.8, 1)), 21.2, '#4A5068', pw, 1);
  G.power = [pw];

  // sorties vidéo (contre l'équerre)
  const outs: number[] = [];
  for (const [y, w] of [[-62, 30], [-26, 30], [10, 30], [46, 26]] as [number, number][]) {
    const p = box(g, -248, y, 20, w, 4, 16, C.metal, 1, 1.5);
    decal(g, ccw(roundRect(-248, y, 14, w - 8, 1, 1)), 16.2, '#9AA0AE', p, 1);
    outs.push(p);
  }
  G.outputs = outs;
}, [0, 0, 0], [-29, 0, 2]);

// ---------- équerre (pièce à part pour le tri de profondeur) ----------
const BRACKET_X = -264;
const bracket = mk('bracket', (g) => {
  const prof: V2[] = ccw([[-106, -16], [112, -16], [112, 58], [-106, 58]]);
  const p = loft(g, [ring(prof, BRACKET_X - 2), ring(prof, BRACKET_X + 2)], {color: C.bracket, axis: 'x'});
  const xo = BRACKET_X - 2.3;
  const rect = (y0: number, y1: number, z0: number, z1: number, col: string, band = 1000) =>
    facePoly(g, [[xo, y0, z0], [xo, y1, z0], [xo, y1, z1], [xo, y0, z1]], [-1, 0, 0], col, p, 0, band);
  for (const [y, w] of [[-62, 24], [-26, 24], [10, 24], [46, 20]] as [number, number][]) rect(y - w / 2, y + w / 2, 6, 14, C.hub);
  for (let k = 0; k < 7; k++) rect(-90 + k * 28, -78 + k * 28, 24, 50, '#8F96A6');
}, [0, 0, 0], [BRACKET_X, 0, 21]);

// ---------- plaque arrière ----------
const backplate = mk('backplate', (g) => {
  const o = ccw(roundRect(-29, 0, 458, 200, 6, 3));
  const p = loft(g, [ring(o, -10), ring(o, -6)], {color: C.back});
  const z = -5.8;
  decal(g, ccw(roundRect(-29, 0, 440, 182, 4, 3)), z, '#4C60C8', p);
  for (const [dx, dy] of [[-60, -60], [60, -60], [-60, 60], [60, 60]]) decal(g, circle(GPU_C[0] + dx, GPU_C[1] + dy, 7, 16), z, C.light, p, 0, 1001);
  for (let k = 0; k < 6; k++) decal(g, ccw(roundRect(150 + (k % 3) * 18, k < 3 ? -40 : 40, 9, 60, 4, 2)), z, C.backDark, p, 0, 1001);
  decal(g, ccw(roundRect(-29, -86, 300, 5, 2, 1)), z - 0.0, C.accent, p, 0, 1002);
}, [0, 0, -290], [-29, 0, -8]);

export const PARTS = {fans, shroud, fins, pipes, plate, paste, pcb, bracket, backplate};
export type PartKey = keyof typeof PARTS;
