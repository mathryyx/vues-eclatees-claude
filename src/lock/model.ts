// Cylindre à goupilles générique (demi-cylindre profil européen), en coupe.
// Unités : millimètres. Repère : x le long de l'axe (face avant x = 0, la clé
// entre par x < 0), y latéral (plan de coupe y = 0, on garde la moitié y ≥ 0),
// z vers le haut (goupilles).
import {Part, V2, V3, addFace, arc, circle, newPart, prism, revolve} from './engine';

export const C = {
  paper: '#F2EEE5',
  grid: '#E3DDD0',
  ink: '#1C2030',
  soft: '#8B8F9E',
  accent: '#F07A3A',
  stator: '#5A72DF',
  statorCut: '#CBD3F4',
  statorIn: '#4152AE',
  rotor: '#E8B84A',
  rotorCut: '#F6E3AA',
  rotorIn: '#A07A26',
  key: '#C9CED8',
  keyPin: '#E0574A',
  driver: '#2F9672',
  spring: '#2A3040',
  cap: '#3A4058',
  cam: '#9AA3B6',
  clip: '#343A50',
  hub: '#B4BBC9',
};

export const RP = 6.5; // rayon du rotor = ligne de cisaillement
export const RS = 8.5; // rayon de la partie ronde du stator
export const TW = 5; // demi-largeur de la tour
export const TOP = 21; // dessus de la tour
export const LEN = 30;
export const PIN_X = [6, 10, 14, 18, 22];
export const PR = 1.45;
export const CR = 1.55;
export const KW_Y = 1.1;
export const KW_ZB = -5.4;
export const KW_ZT = 3.9;
export const KW_END = 28;
export const KT = 0.95;
export const CUTS = [1.0, 2.6, 0.4, 2.0, 1.4];
export const KEY_PIN_L = CUTS.map((h) => RP - h);
export const DRIVER_L = 5.0;
export const REST = -1.0;
export const CAP_B = 18.5;
export const CAP_H = 2.5;
export const KEY_TIP = 27;
export const D2R = Math.PI / 180;

/** Arête supérieure de la clé (denture), coordonnée locale depuis l'épaulement. */
export const keyTop = (x: number) => {
  let v = 3.5;
  for (let j = 0; j < 5; j++) v = Math.min(v, CUTS[j] + Math.max(0, Math.abs(x - PIN_X[j]) - 0.45) * 1.0);
  return Math.min(v, -1.2 + (KEY_TIP - x) * 1.35);
};
const keyBottom = (x: number) => -5 + Math.max(0, x - 25.5) * 1.6;

// ---------- stator (corps) ----------
const PHI_T = Math.acos(TW / RS);
const ZT = RS * Math.sin(PHI_T);
const halfProfile = (): V2[] => [
  [0, -RS],
  ...arc(0, 0, RS, -Math.PI / 2, PHI_T, 14).slice(1),
  [TW, TOP],
  [0, TOP],
  [0, RP],
  ...arc(0, 0, RP, Math.PI / 2, -Math.PI / 2, 16).slice(1),
];

const xAxisPt = (r: number, a: number, t: number): V3 => [t, r * Math.cos(a), r * Math.sin(a)];
const xAxis = (t: number): V3 => [t, 0, 0];

const buildStator = (): Part => {
  const P = newPart();
  // extérieur (le plus souvent caché)
  revolve(P, [[RS, 0], [RS, LEN]], -Math.PI / 2, PHI_T, 12, xAxisPt, xAxis, {color: C.stator, group: 0});
  addFace(P, [[0, TW, ZT], [LEN, TW, ZT], [LEN, TW, TOP], [0, TW, TOP]], [0, 1, 0], {color: C.stator, kind: 'solid', group: 0});
  addFace(P, halfProfile().map(([y, z]) => [LEN, y, z] as V3), [1, 0, 0], {color: C.stator, kind: 'solid', group: 0});
  // intérieur : alésage et chambres
  revolve(P, [[RP, 0], [RP, LEN]], -Math.PI / 2, Math.PI / 2, 16, xAxisPt, xAxis, {
    color: C.statorIn, kind: 'inner', group: 1, inward: true,
  });
  for (const x of PIN_X) {
    revolve(P, [[CR, RP - 0.3], [CR, TOP]], 0, Math.PI, 10, (r, a, t) => [x + r * Math.cos(a), r * Math.sin(a), t], (t) => [x, 0, t], {
      color: C.statorIn, kind: 'inner', group: 1, inward: true,
    });
  }
  // faces de coupe (y = 0)
  const cut = (x0: number, x1: number, z0: number, z1: number) =>
    addFace(P, [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, -1, 0], {color: C.statorCut, kind: 'cut', hatch: 'A', group: 2});
  cut(0, LEN, -RS, -RP);
  const bars = [0, ...PIN_X.flatMap((x) => [x - CR, x + CR]), LEN];
  for (let k = 0; k < bars.length; k += 2) cut(bars[k], bars[k + 1], RP, TOP);
  // face avant
  addFace(P, halfProfile().map(([y, z]) => [0, y, z] as V3), [-1, 0, 0], {color: C.stator, kind: 'solid', group: 2});
  // dessus de la tour, entailles des chambres
  const top: V2[] = [[0, 0]];
  for (const x of PIN_X) top.push(...arc(x, 0, CR, Math.PI, 0, 8));
  top.push([LEN, 0], [LEN, TW], [0, TW]);
  addFace(P, top.map(([x, y]) => [x, y, TOP] as V3), [0, 0, 1], {color: C.stator, kind: 'solid', group: 2});
  return P;
};

// ---------- rotor (barillet) ----------
const buildRotor = (): Part => {
  const P = newPart();
  // intérieur : canal de clé et perçages
  addFace(P, [[0, KW_Y, KW_ZB], [KW_END, KW_Y, KW_ZB], [KW_END, KW_Y, KW_ZT], [0, KW_Y, KW_ZT]], [0, -1, 0], {color: C.rotorIn, kind: 'inner', group: 0});
  addFace(P, [[0, 0, KW_ZB], [KW_END, 0, KW_ZB], [KW_END, KW_Y, KW_ZB], [0, KW_Y, KW_ZB]], [0, 0, 1], {color: C.rotorIn, kind: 'inner', group: 0});
  addFace(P, [[0, 0, KW_ZT], [KW_END, 0, KW_ZT], [KW_END, KW_Y, KW_ZT], [0, KW_Y, KW_ZT]], [0, 0, -1], {color: C.rotorIn, kind: 'inner', group: 0});
  addFace(P, [[KW_END, 0, KW_ZB], [KW_END, KW_Y, KW_ZB], [KW_END, KW_Y, KW_ZT], [KW_END, 0, KW_ZT]], [-1, 0, 0], {color: C.rotorIn, kind: 'inner', group: 0});
  for (const z of [-2.7, 1.2]) P.lines.push({pts: [[0.3, KW_Y - 0.02, z], [KW_END - 0.3, KW_Y - 0.02, z]], w: 1, color: '#7A5C18', group: 0});
  for (const x of PIN_X) {
    revolve(P, [[CR, KW_ZT], [CR, RP - 0.12]], 0, Math.PI, 10, (r, a, t) => [x + r * Math.cos(a), r * Math.sin(a), t], (t) => [x, 0, t], {
      color: C.rotorIn, kind: 'inner', group: 0, inward: true,
    });
  }
  // extérieur, découpé en tronçons le long de x
  const prof: [number, number][] = [];
  for (let k = 0; k <= 10; k++) prof.push([RP, (LEN * k) / 10]);
  revolve(P, prof, -Math.PI / 2, Math.PI / 2, 18, xAxisPt, xAxis, {color: C.rotor, group: 1, tag: 'outer'});
  const front: V2[] = [...arc(0, 0, RP, -Math.PI / 2, Math.PI / 2, 18), [0, KW_ZT], [KW_Y, KW_ZT], [KW_Y, KW_ZB], [0, KW_ZB]];
  addFace(P, front.map(([y, z]) => [0, y, z] as V3), [-1, 0, 0], {color: C.rotor, kind: 'solid', group: 1});
  addFace(P, arc(0, 0, RP, -Math.PI / 2, Math.PI / 2, 18).map(([y, z]) => [LEN, y, z] as V3), [1, 0, 0], {color: C.rotor, kind: 'solid', group: 1});
  const cutPoly = (pts: V2[]) =>
    addFace(P, pts.map(([x, z]) => [x, 0, z] as V3), [0, -1, 0], {color: C.rotorCut, kind: 'cut', hatch: 'B', group: 1});
  const x5 = PIN_X[4] + CR;
  cutPoly([[0, -RP], [LEN, -RP], [LEN, RP], [x5, RP], [x5, KW_ZT], [KW_END, KW_ZT], [KW_END, KW_ZB], [0, KW_ZB]]);
  const edges = [0, ...PIN_X.slice(0, 4).flatMap((x) => [x - CR, x + CR]), PIN_X[4] - CR];
  for (let k = 0; k < edges.length; k += 2) cutPoly([[edges[k], KW_ZT], [edges[k + 1], KW_ZT], [edges[k + 1], RP], [edges[k], RP]]);
  return P;
};

// ---------- clé ----------
const buildKey = (): Part => {
  const P = newPart();
  const pts: V2[] = [];
  for (let x = 0; x <= KEY_TIP + 1e-6; x += 0.25) pts.push([x, keyTop(x)]);
  pts.push([KEY_TIP, keyBottom(KEY_TIP)], [25.5, -5], [0, -5], [0, -6.2], [-3, -6.2]);
  const bc: V2 = [-11.6, -0.6];
  const R = 8.6;
  const aB = Math.atan2(-6.2 - bc[1], Math.sqrt(R * R - (6.2 + bc[1]) ** 2));
  const aT = Math.atan2(4.8 - bc[1], Math.sqrt(R * R - (4.8 - bc[1]) ** 2));
  pts.push(...arc(bc[0], bc[1], R, aB, aT - Math.PI * 2, 40));
  pts.push([-3, 4.8], [0, 4.8]);
  const hole = circle(-14.4, -0.6, 2.2, 20);
  prism(P, pts, [hole], -KT, KT, (u, v, t) => [u, t, v], {color: C.key, sideGroup: 0, capGroup: 1, smooth: 24});
  const yF = -KT - 0.03;
  for (const z of [-1.8, -3.6]) P.lines.push({pts: [[0.6, yF, z], [24.6, yF, z]], w: 1.1, color: '#8C93A3', group: 1});
  const ring = circle(bc[0], bc[1], 6.4, 40);
  P.lines.push({pts: [...ring, ring[0]].map(([x, z]) => [x, yF, z] as V3), w: 1.1, color: '#8C93A3', group: 1});
  return P;
};

// ---------- goupilles, ressorts, bouchons ----------
const zAxisPt = (r: number, a: number, t: number): V3 => [r * Math.cos(a), r * Math.sin(a), t];
const zAxis = (t: number): V3 => [0, 0, t];
const pin = (profile: [number, number][], color: string, n = 18) => {
  const P = newPart();
  revolve(P, profile, 0, Math.PI * 2, n, zAxisPt, zAxis, {color, group: 0, capStart: color, capEnd: color, full: true});
  return P;
};

// ---------- came, moyeu, clip ----------
const xMap = (u: number, v: number, t: number): V3 => [t, u, v];
const buildCam = (): Part => {
  const P = newPart();
  const r = 6;
  const w = 3.5;
  const zj = -Math.sqrt(r * r - w * w);
  const a0 = Math.atan2(zj, w);
  const outline: V2[] = [
    ...arc(0, 0, r, a0, Math.PI - a0, 30),
    [-w, -9.5],
    ...arc(0, -9.5, w, Math.PI, Math.PI * 2, 12).slice(1, -1),
    [w, -9.5],
  ];
  prism(P, outline, [], 0, 2.5, xMap, {color: C.cam, sideGroup: 0, capGroup: 1, smooth: 30});
  return P;
};
const buildHub = (len: number): Part => {
  const P = newPart();
  revolve(P, [[3.2, 0], [3.2, len]], 0, Math.PI * 2, 20, xAxisPt, xAxis, {color: C.hub, group: 0, capStart: C.hub, capEnd: C.hub, full: true});
  return P;
};
const buildClip = (): Part => {
  const P = newPart();
  const g0 = (115 * Math.PI) / 180;
  const g1 = (425 * Math.PI) / 180;
  const ro = 5.4;
  const ri = 3.3;
  const rm = (ro + ri) / 2;
  const hw = (ro - ri) / 2;
  const end = (g: number, from: number) => arc(rm * Math.cos(g), rm * Math.sin(g), hw, from, from + Math.PI, 6).slice(1, -1);
  const outline: V2[] = [
    ...arc(0, 0, ro, g0, g1, 40),
    ...end(g1, g1),
    ...arc(0, 0, ri, g1, g0, 30),
    ...end(g0, g0 + Math.PI),
  ];
  const holes = [g0 + 0.2, g1 - 0.2].map((g) => circle(rm * Math.cos(g), rm * Math.sin(g), 0.5, 10));
  prism(P, outline, holes, 0, 1, xMap, {color: C.clip, sideGroup: 0, capGroup: 1, smooth: 30});
  return P;
};

export const PARTS = {
  stator: buildStator(),
  rotor: buildRotor(),
  key: buildKey(),
  keyPins: KEY_PIN_L.map((L) => pin([[0.45, 0], [PR, 1.0], [PR, L]], C.keyPin)),
  drivers: [0, 1, 2, 3, 4].map(() => pin([[1.2, 0], [PR, 0.25], [PR, DRIVER_L - 0.25], [1.2, DRIVER_L]], C.driver)),
  caps: [0, 1, 2, 3, 4].map(() => pin([[CR, 0], [CR, CAP_H - 0.4], [1.25, CAP_H]], C.cap)),
  cam: buildCam(),
  hubA: buildHub(0.7),
  hubB: buildHub(0.8),
  clip: buildClip(),
};

// positions axiales (x) des pièces arrière à l'assemblage
export const CAM_X = 30.3;
export const HUB_A_X = 32.8;
export const CLIP_X = 33.5;
export const HUB_B_X = 34.5;
