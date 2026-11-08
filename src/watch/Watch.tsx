import React, {useEffect, useMemo, useState} from 'react';
import {
  AbsoluteFill, Easing, Html5Audio, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {Cam, DrawItem, PartInstance, V2, V3, project, rotAround} from './engine';
import {renderPart} from './engine';
import {ANCHOR_PIVOT, BAL_Z_TOP, C, PARTS, POS, PartDef, Role, anchorToWorld} from './model';

// ---------- rythme : 120 BPM, un temps = 15 images ; balancier 3 Hz = un tic toutes les 5 images ----------
const STOP = 150; // les ponts partent : le rouage n'a plus de pivots, la montre s'arrête
const COLLAPSE = 405; // début du remontage
const IMPACT = 420; // tout est remonté (temps 28)
const HL0 = 252; // surbrillance des étiquettes, une par croche

const FONT_CSS = `
@font-face { font-family: 'WaCond'; src: local('AvenirNextCondensed-DemiBold'), local('Avenir Next Condensed Demi Bold'); }
@font-face { font-family: 'WaTitle'; src: local('AvenirNext-Bold'), local('Avenir Next Bold'); }
@font-face { font-family: 'WaMono'; src: local('Menlo-Regular'), local('Menlo'); }
@font-face { font-family: 'WaMonoB'; src: local('Menlo-Bold'); }
`;
const FAMILIES = ['WaCond', 'WaTitle', 'WaMono', 'WaMonoB'];

const P = PARTS;
type PK = keyof typeof PARTS;
const START: Record<PK, number> = {
  glass: 60, caseOuter: 75, caseLugs: 75, caseInner: 75, crown: 84, hands: 90, dial: 105, plate: 120, fond: 135, ponts: 150,
  barrel: 165, train: 180, escape: 195, anchor: 210, balance: 225,
};
const KEYS = Object.keys(PARTS) as PK[];

type AnchorSpec = {kind: 'rim'; c: V2; r: number; z: number; piece?: number} | {kind: 'pt'; p: V3; piece?: number};
interface LabelDef {
  n: string;
  name: string;
  spec: string;
  part: PK;
  side: 'L' | 'R';
  at: AnchorSpec;
  start: number;
}
const LABELS: LabelDef[] = [
  {n: '01', name: 'Glace', spec: 'verre saphir', part: 'glass', side: 'L', at: {kind: 'rim', c: [0, 0], r: 124, z: 22}, start: 60},
  {n: '02', name: 'Boîte', spec: 'carrure · lunette · cornes', part: 'caseOuter', side: 'L', at: {kind: 'rim', c: [0, 0], r: 150, z: 4}, start: 75},
  {n: '03', name: 'Couronne', spec: 'remontoir · mise à l’heure', part: 'crown', side: 'R', at: {kind: 'pt', p: [174, 0, 6]}, start: 84},
  {n: '04', name: 'Aiguilles', spec: 'heures · minutes · secondes', part: 'hands', side: 'R', at: {kind: 'pt', p: [0, 62, 11], piece: 1}, start: 90},
  {n: '05', name: 'Cadran', spec: 'cœur ouvert', part: 'dial', side: 'L', at: {kind: 'rim', c: [0, 0], r: 126, z: 6.5}, start: 105},
  {n: '06', name: 'Platine', spec: 'laiton rhodié · perlage', part: 'plate', side: 'R', at: {kind: 'rim', c: [0, 0], r: 122, z: 4}, start: 120},
  {n: '07', name: 'Fond', spec: 'acier · vissé', part: 'fond', side: 'L', at: {kind: 'rim', c: [0, 0], r: 140, z: -22}, start: 135},
  {n: '08', name: 'Ponts', spec: 'barillet · rouage · coq', part: 'ponts', side: 'R', at: {kind: 'pt', p: [98, 62, -15]}, start: 150},
  {n: '09', name: 'Rubis', spec: 'pierres de pivot · ×17', part: 'ponts', side: 'R', at: {kind: 'pt', p: [22, -74, -15]}, start: 157},
  {n: '10', name: 'Barillet', spec: 'ressort de barillet · 42 h', part: 'barrel', side: 'R', at: {kind: 'rim', c: POS.barrel, r: 43, z: -4}, start: 165},
  {n: '11', name: 'Rouage', spec: 'centre · moyenne · secondes', part: 'train', side: 'R', at: {kind: 'rim', c: POS.third, r: 28, z: -9, piece: 1}, start: 180},
  {n: '12', name: 'Roue d’échappement', spec: '15 dents · acier', part: 'escape', side: 'L', at: {kind: 'rim', c: POS.escape, r: 16, z: -8.5}, start: 195},
  {n: '13', name: 'Ancre', spec: 'palettes en rubis', part: 'anchor', side: 'L', at: {kind: 'pt', p: [...anchorToWorld([12, 0]), -7.4] as V3}, start: 210},
  {n: '14', name: 'Balancier-spiral', spec: '3 Hz · 21 600 alt./h', part: 'balance', side: 'L', at: {kind: 'rim', c: POS.balance, r: 29, z: -6.6}, start: 225},
];
const TOTAL = LABELS.length;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const DEG = Math.PI / 180;

const collapseFactor = (f: number) => {
  if (f < COLLAPSE) return 1;
  if (f >= IMPACT) return 0;
  return 1 - Easing.in(Easing.cubic)((f - COLLAPSE) / (IMPACT - COLLAPSE));
};

const amountOf = (k: PK, f: number, fps: number) => {
  const s = START[k];
  if (f < s) return 0;
  const sp = spring({frame: f - s, fps, config: {damping: 15, stiffness: 150, mass: 0.75}});
  return sp * collapseFactor(f);
};

// ---------- mécanique : temps « effectif » de marche ----------
const tEff = (f: number) => (f < STOP ? f : f < IMPACT ? STOP : STOP + (f - IMPACT));
const steps = (t: number) => {
  const k = Math.floor(t / 5);
  return k + clamp01((t - k * 5) / 1.5);
};
const balanceAmp = (f: number) => {
  if (f < STOP) return 96;
  if (f < IMPACT) return 96 * Math.exp(-(f - STOP) / 26);
  return 96 * (1 - Math.exp(-(f - IMPACT) / 2.5));
};
const balanceAngle = (f: number) => balanceAmp(f) * Math.sin((2 * Math.PI * f) / 10) * DEG;
const anchorAngle = (f: number) => {
  const t = tEff(f);
  const k = Math.floor(t / 5);
  const e = clamp01((t - k * 5) / 1.5);
  const s = (i: number) => (i % 2 ? 1 : -1);
  return 8 * (s(k - 1) + (s(k) - s(k - 1)) * e) * DEG;
};
const handSpin = (f: number) => Easing.out(Easing.cubic)(clamp01((f - IMPACT - 2) / 20));

const roleAngle = (role: Role, f: number): number => {
  const S = steps(tEff(f));
  switch (role) {
    case 'escape': return -S * 12 * DEG;
    case 'fourth': return S * 3 * DEG;
    case 'third': return -S * 1.2 * DEG;
    case 'center': return S * 0.5 * DEG;
    case 'barrel': return -S * 0.2 * DEG;
    case 'balance': return balanceAngle(f);
    case 'anchor': return anchorAngle(f);
    case 'second': return -S * 1 * DEG;
    case 'minute': return -(60 + 360 * handSpin(f)) * DEG;
    case 'hour': return -(275 + 30 * handSpin(f)) * DEG;
    default: return 0;
  }
};
const PIVOT: Partial<Record<Role, V2>> = {
  barrel: POS.barrel, center: POS.center, third: POS.third, fourth: POS.fourth, escape: POS.escape,
  anchor: ANCHOR_PIVOT, balance: POS.balance, hour: [0, 0], minute: [0, 0], second: [0, 0],
};

// la vue éclatée s'ouvre progressivement : les premières pièces partent moins loin, puis tout s'écarte
const spread = (f: number) => interpolate(f, [60, 215], [0.45, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});

const FIXED: Record<string, number> = {glass: 330, caseOuter: 210, caseLugs: 210, caseInner: 210, crown: 210};

const offsetOf = (part: PartDef, amt: number, f: number, piece = 0): V3 => {
  const e = part.explode;
  const pe = part.pieceExplode[piece] ?? [0, 0, 0];
  const ph = (part.zRef * 0.37 + part.explode[2] * 0.013) % (Math.PI * 2);
  const bob = Math.sin((f / 60) * Math.PI * 2 + ph) * 3 * clamp01(amt);
  const g = spread(f);
  const fx = FIXED[part.id] ?? 0; // part non dilatée (garde l'écart boîte / aiguilles)
  const ez = ((e[2] + pe[2] - fx) * g + fx) * amt;
  return [(e[0] + pe[0]) * g * amt, (e[1] + pe[1]) * g * amt, ez + bob];
};

const makeXf = (part: PartDef, amt: number, f: number) => {
  const angles = part.roles.map((r) => roleAngle(r, f));
  const offs = part.roles.map((_, i) => offsetOf(part, amt, f, i));
  return (p: V3, piece: number): V3 => {
    let q = p;
    const role = part.roles[piece];
    const pv = PIVOT[role];
    if (pv && angles[piece]) q = rotAround(q, [pv[0], pv[1], 0], 'z', angles[piece]);
    const o = offs[piece] ?? offs[0];
    return [q[0] + o[0], q[1] + o[1], q[2] + o[2]];
  };
};

// ---------- caméra : cadrage automatique sur l'empilement (amortis, sans rebond) ----------
const ZSPAN = (() => {
  const out = {} as Record<PK, [number, number, number]>;
  for (const k of KEYS) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of P[k].geo.verts) {
      lo = Math.min(lo, v[2]);
      hi = Math.max(hi, v[2]);
    }
    const pex = Math.max(...P[k].pieceExplode.map((v) => v[2]), 0);
    out[k] = [lo, hi, pex];
  }
  return out;
})();
const smoothAmt = (k: PK, f: number) => (f < START[k] ? 0 : Easing.out(Easing.cubic)(clamp01((f - START[k]) / 16)) * collapseFactor(f));
const AVAIL = 452;
const camAt = (f: number): Cam => {
  const az = interpolate(f, [0, 450], [-38, 22], {easing: Easing.inOut(Easing.sin)});
  let top = -Infinity;
  let bot = Infinity;
  const g = spread(f);
  for (const k of KEYS) {
    const a = smoothAmt(k, f);
    const [lo, hi, pex] = ZSPAN[k];
    const fx = FIXED[P[k].id] ?? 0;
    const ez = ((P[k].explode[2] - fx) * g + fx) * a;
    top = Math.max(top, hi + ez + pex * g * a);
    bot = Math.min(bot, lo + ez);
  }
  const half = ((top - bot) / 2) * 0.848 + 84;
  const cap = f < COLLAPSE ? interpolate(f, [0, 58, 74], [2.55, 2.4, 1.2], {extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad)}) : 2.05;
  let scale = Math.min(cap, AVAIL / half);
  const cz = (top + bot) / 2;
  let cy = interpolate(f, [0, 60, 90], [690, 690, 718], {extrapolateRight: 'clamp'});
  if (f >= COLLAPSE) cy = 718 - 50 * Easing.in(Easing.cubic)(clamp01((f - COLLAPSE) / (IMPACT - COLLAPSE)));
  if (f >= IMPACT) {
    const k = f - IMPACT;
    scale = 2.05 + 0.07 * Math.exp(-k / 4) * Math.cos(k * 0.9);
  }
  return {az: az * DEG, el: 32 * DEG, scale, cx: 540, cy, cz};
};

const shakeAt = (f: number): [number, number] => {
  if (f < IMPACT) return [0, 0];
  const k = f - IMPACT;
  const a = 9 * Math.exp(-k / 3.5);
  return [a * Math.sin(k * 2.3), a * Math.cos(k * 3.1)];
};

// ---------- étiquettes ----------
const LEFT_X = 306;
const RIGHT_X = 774;
const GAP = 66;
const layoutSide = (ys: number[]) => {
  const ord = ys.map((y, i) => ({y, i})).sort((a, b) => a.y - b.y);
  const out = new Array(ys.length).fill(0);
  let prev = 205 - GAP;
  const pos = ord.map((o) => {
    const y = Math.max(o.y, prev + GAP);
    prev = y;
    return y;
  });
  const maxY = 1215;
  for (let k = pos.length - 1; k >= 0; k--) {
    const lim = k === pos.length - 1 ? maxY : pos[k + 1] - GAP;
    if (pos[k] > lim) pos[k] = lim;
  }
  ord.forEach((o, k) => (out[o.i] = pos[k]));
  return out;
};

const anchorWorld = (L: LabelDef, part: PartDef, xf: (p: V3, piece: number) => V3, cam: Cam): V3 => {
  const a = L.at;
  if (a.kind === 'pt') return xf(a.p, a.piece ?? 0);
  // point du bord tourné vers le côté de l'étiquette, un peu vers l'avant
  const ca = Math.cos(cam.az);
  const sa = Math.sin(cam.az);
  const sx: V2 = [ca, -sa]; // direction monde -> écran +x
  const fr: V2 = [-sa, -ca]; // vers l'observateur
  const s = L.side === 'L' ? -1 : 1;
  const dx = s * sx[0] * 0.87 + fr[0] * 0.5;
  const dy = s * sx[1] * 0.87 + fr[1] * 0.5;
  const pv = PIVOT[part.roles[a.piece ?? 0]];
  void pv;
  const p: V3 = [a.c[0] + dx * a.r, a.c[1] + dy * a.r, a.z];
  // le point d'ancrage ne tourne pas avec la roue : on applique seulement la translation
  const o = xf([a.c[0], a.c[1], 0], -1);
  return [p[0] + o[0] - a.c[0], p[1] + o[1] - a.c[1], p[2] + o[2]];
};

const FontGate: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [handle] = useState(() => delayRender('Polices système'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all(FAMILIES.map((f) => document.fonts.load(`40px ${f}`)))
      .catch(() => undefined)
      .then(() => {
        setReady(true);
        continueRender(handle);
      });
  }, [handle]);
  return (
    <>
      <style>{FONT_CSS}</style>
      {ready ? children : null}
    </>
  );
};

const Grid: React.FC = () => {
  const lines: React.ReactNode[] = [];
  for (let x = 54; x < 1080; x += 54) lines.push(<line key={'x' + x} x1={x} y1={0} x2={x} y2={1350} />);
  for (let y = 54; y < 1350; y += 54) lines.push(<line key={'y' + y} x1={0} y1={y} x2={1080} y2={y} />);
  return <g stroke={C.grid} strokeWidth={1}>{lines}</g>;
};

const fmtDeg = (d: number) => `${d < 0 ? '−' : '+'}${String(Math.abs(Math.round(d))).padStart(2, '0')}°`;

export const Watch: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const f = frame;

  const hi = f >= HL0 && f < HL0 + TOTAL * 7.5 ? Math.floor((f - HL0) / 7.5) : -1;
  const hiK = hi >= 0 ? 1 - ((f - HL0) % 7.5) / 7.5 : 0;

  const scene = useMemo(() => {
    const cam = camAt(f);
    const [shx, shy] = shakeAt(f);
    cam.cx += shx;
    cam.cy += shy;
    const amts = {} as Record<PK, number>;
    for (const k of KEYS) amts[k] = amountOf(k, f, fps);
    const xfs = {} as Record<PK, (p: V3, piece: number) => V3>;
    for (const k of KEYS) {
      const base = makeXf(P[k], amts[k], f);
      const part = P[k];
      xfs[k] = (p, piece) => {
        if (piece < 0) {
          const o = offsetOf(part, amts[k], f, 0);
          return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
        }
        return base(p, piece);
      };
    }

    // ordre de dessin : par altitude courante
    const avgPex = (part: PartDef) => part.pieceExplode.reduce((s, v) => s + v[2], 0) / Math.max(1, part.pieceExplode.length);
    const key = (k: PK) => P[k].zRef + (P[k].explode[2] + avgPex(P[k])) * amts[k];
    const keys = {} as Record<PK, number>;
    for (const k of KEYS) keys[k] = key(k);
    keys.crown = keys.caseOuter + 0.2;
    const caseBottom = offsetOf(P.caseOuter, amts.caseOuter, f)[2] - 22;
    const handsTop = offsetOf(P.hands, amts.hands, f, 2)[2] + 13;
    keys.caseInner = caseBottom > handsTop ? keys.caseOuter - 0.01 : -1e9;
    keys.caseLugs = caseBottom > handsTop ? keys.caseOuter - 0.02 : -1e9 - 1;
    const order = [...KEYS].sort((a, b) => keys[a] - keys[b]);

    // surbrillance : pièce de l'étiquette en cours
    const hiPart = hi >= 0 ? LABELS[hi].part : null;

    const items: DrawItem[] = [];
    for (const k of order) {
      const inst: PartInstance = {
        geo: P[k].geo,
        topo: P[k].topo,
        xf: xfs[k],
        tint: hiPart === k || (hiPart === 'caseOuter' && (k === 'caseInner' || k === 'caseLugs')) ? 0.32 * hiK : 0,
        tintColor: C.accent,
      };
      renderPart(inst, cam, items);
      if (k === 'balance') {
        // spiral : extrémité intérieure solidaire du balancier, extérieure fixe (piton) — il « respire »
        const rot = balanceAngle(f);
        const o = offsetOf(P.balance, amts.balance, f, 0);
        const [bx, by] = POS.balance;
        const n = 200;
        let d = '';
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const r = 4.2 + (21.5 - 4.2) * t;
          const a = 0.4 + t * 6 * Math.PI * 2 + rot * (1 - t);
          const w: V3 = [bx + r * Math.cos(a) + o[0], by + r * Math.sin(a) + o[1], BAL_Z_TOP + 0.4 + o[2]];
          const s = project(w, cam);
          d += (i ? 'L' : 'M') + s[0].toFixed(1) + ' ' + s[1].toFixed(1);
        }
        // courbe terminale vers le piton
        const aEnd = 0.4 + 6 * Math.PI * 2;
        for (let i = 1; i <= 8; i++) {
          const a = aEnd + (i / 8) * 0.7;
          const r = 21.5 + (i / 8) * 3.5;
          const s = project([bx + r * Math.cos(a) + o[0], by + r * Math.sin(a) + o[1], BAL_Z_TOP + 0.4 + o[2]], cam);
          d += 'L' + s[0].toFixed(1) + ' ' + s[1].toFixed(1);
        }
        items.push({fill: C.hairspring, d, edges: '', stroke: 1.15});
      }
    }

    // traits d'axe (mixtes)
    const axes: {a: [number, number]; b: [number, number]; dashed?: boolean}[] = [];
    const zOf = (k: PK, z: number, piece = 0) => z + offsetOf(P[k], amts[k], f, piece)[2];
    const axis = (x: number, y: number, zs: number[], dashed?: boolean) => {
      const lo = Math.min(...zs);
      const hi2 = Math.max(...zs);
      if (hi2 - lo < 14) return;
      const a = project([x, y, lo], cam);
      const b = project([x, y, hi2], cam);
      axes.push({a: [a[0], a[1]], b: [b[0], b[1]], dashed});
    };
    axis(0, 0, [zOf('fond', -22), zOf('ponts', -15), zOf('train', -6), zOf('plate', 4), zOf('dial', 6.5), zOf('hands', 13, 2), zOf('glass', 22)]);
    const pivotAxis = (c: V2, k: PK, z: number, piece = 0) => axis(c[0], c[1], [zOf('ponts', -15), zOf(k, z, piece), zOf('plate', -2)], true);
    pivotAxis(POS.third, 'train', -9, 1);
    pivotAxis(POS.fourth, 'train', -10.5, 2);
    pivotAxis(POS.escape, 'escape', -8.5);
    pivotAxis(ANCHOR_PIVOT, 'anchor', -7.4);
    // axe de la tige de remontoir (la couronne sort le long de x)
    if (amts.crown > 0.05) {
      const oc = offsetOf(P.crown, amts.crown, f);
      const a = project([150, oc[1], -2 + oc[2]], cam);
      const b = project([178 + oc[0], oc[1], -2 + oc[2]], cam);
      axes.push({a: [a[0], a[1]], b: [b[0], b[1]]});
    }
    // étiquettes
    const lab = LABELS.map((L) => {
      const part = P[L.part];
      const cur = project(anchorWorld(L, part, xfs[L.part], cam), cam);
      const xfFin = makeXf(part, 1, f);
      const finXf = (p: V3, piece: number): V3 => {
        if (piece < 0) {
          const o = offsetOf(part, 1, f, 0);
          return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
        }
        return xfFin(p, piece);
      };
      const fin = project(anchorWorld(L, part, finXf, cam), cam);
      return {L, cur, fin};
    });
    const ys = new Map<LabelDef, number>();
    for (const side of ['L', 'R'] as const) {
      const sel = lab.filter((l) => l.L.side === side);
      const pos = layoutSide(sel.map((l) => l.fin[1]));
      sel.forEach((l, i) => ys.set(l.L, pos[i]));
    }
    return {cam, items, axes, lab, ys};
  }, [f, fps, hi, hiK]);

  const {cam, items, axes, lab, ys} = scene;
  const count = LABELS.filter((L) => f >= L.start).length;
  const azDeg = (cam.az * 180) / Math.PI;

  const endIn = interpolate(f, [IMPACT + 3, IMPACT + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const endIn2 = interpolate(f, [IMPACT + 9, IMPACT + 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const burstT = f >= IMPACT ? (f - IMPACT) / 10 : -1;

  return (
    <FontGate>
      <AbsoluteFill style={{background: C.paper}}>
        <Html5Audio src={staticFile('watch/watch.wav')} />
        <svg width={1080} height={1350} viewBox="0 0 1080 1350" style={{position: 'absolute', inset: 0}}>
          <Grid />
          <rect x={28} y={28} width={1024} height={1294} fill="none" stroke={C.ink} strokeWidth={1.6} />
          {[[28, 28], [1052, 28], [28, 1322], [1052, 1322]].map(([x, y], i) => (
            <g key={i} stroke={C.ink} strokeWidth={1.6}>
              <line x1={x - 12} y1={y} x2={x + 12} y2={y} />
              <line x1={x} y1={y - 12} x2={x} y2={y + 12} />
            </g>
          ))}

          <g stroke={C.soft} strokeWidth={1.3} fill="none">
            {axes.map((a, i) => (
              <line key={i} x1={a.a[0]} y1={a.a[1]} x2={a.b[0]} y2={a.b[1]} strokeDasharray={a.dashed ? '6 5' : '16 5 3 5'} />
            ))}
          </g>

          <g strokeLinejoin="round" strokeLinecap="round">
            {items.map((it, i) =>
              it.stroke ? (
                <path key={i} d={it.d} fill="none" stroke={it.fill} strokeWidth={it.stroke} opacity={it.opacity} />
              ) : (
                <g key={i}>
                  <path d={it.d} fill={it.fill} fillOpacity={it.opacity} fillRule={it.evenodd ? 'evenodd' : undefined} stroke={it.opacity ? 'none' : it.fill} strokeWidth={0.9} />
                  {it.edges ? <path d={it.edges} fill="none" stroke={C.ink} strokeWidth={1.6} opacity={it.opacity ? 0.75 : 1} /> : null}
                </g>
              ),
            )}
          </g>

          {burstT >= 0 && burstT <= 1 ? (
            <g stroke={C.ink} strokeWidth={2.2} strokeLinecap="round">
              {Array.from({length: 12}, (_, i) => {
                const a = (i / 12) * Math.PI * 2 + 0.2;
                const r0 = 360 + burstT * 90;
                const r1 = r0 + 40 * (1 - burstT);
                const cx = 540;
                const cy = 650;
                return <line key={i} x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0 * 0.62} x2={cx + Math.cos(a) * r1} y2={cy + Math.sin(a) * r1 * 0.62} opacity={1 - burstT} />;
              })}
            </g>
          ) : null}

          {lab.map(({L, cur}, li) => {
            const t = f - L.start;
            const lineP = interpolate(t, [6, 15], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
            const txtP = interpolate(t, [11, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
            const out = interpolate(f, [391, 403], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});
            const lp = lineP * out;
            const tp = txtP * out;
            if (lp <= 0.001) return null;
            const y = ys.get(L)!;
            const left = L.side === 'L';
            const bx = left ? LEFT_X + 14 : RIGHT_X - 14;
            const ax = cur[0];
            const ay = cur[1];
            const sx = left ? bx + 15 : bx - 15;
            const ex = ax + (sx - ax) * lp;
            const ey = ay + (y - ay) * lp;
            const isHi = li === hi;
            const k = isHi ? hiK : 0;
            const shift = (1 - tp) * 24 * (left ? 1 : -1);
            return (
              <g key={L.n}>
                <line x1={ax} y1={ay} x2={ex} y2={ey} stroke={isHi ? C.accent : C.ink} strokeWidth={isHi ? 2 : 1.4} />
                <circle cx={ax} cy={ay} r={4.6} fill={isHi ? C.accent : C.ink} stroke={C.paper} strokeWidth={1.6} />
                <g opacity={tp} transform={`translate(${shift},0)`}>
                  <circle cx={bx} cy={y} r={15 + k * 3} fill={isHi ? C.accent : C.paper} stroke={isHi ? C.accent : C.ink} strokeWidth={1.5} />
                  <text x={bx} y={y + 4.6} textAnchor="middle" fontFamily="WaMonoB" fontSize={13} fill={isHi ? C.paper : C.ink}>
                    {L.n}
                  </text>
                  <text x={left ? bx - 24 : bx + 24} y={y - 3} textAnchor={left ? 'end' : 'start'} fontFamily="WaCond" fontSize={26} fill={C.ink} stroke={C.paper} strokeWidth={5} paintOrder="stroke">
                    {L.name}
                  </text>
                  <text x={left ? bx - 24 : bx + 24} y={y + 21} textAnchor={left ? 'end' : 'start'} fontFamily="WaMono" fontSize={14} fill={C.soft} stroke={C.paper} strokeWidth={4} paintOrder="stroke">
                    {L.spec}
                  </text>
                </g>
              </g>
            );
          })}

          <g>
            <text x={64} y={92} fontFamily="WaMonoB" fontSize={17} fill={C.accent} letterSpacing={2}>
              FIG. 03 — VUE ÉCLATÉE
            </text>
            <text x={62} y={150} fontFamily="WaTitle" fontSize={54} fill={C.ink} letterSpacing={-1}>
              Anatomie d’une montre
            </text>
            <text x={1016} y={92} textAnchor="end" fontFamily="WaMonoB" fontSize={17} fill={C.ink} letterSpacing={2}>
              PIÈCES {String(count).padStart(2, '0')}/{TOTAL}
            </text>
            <text x={1016} y={118} textAnchor="end" fontFamily="WaMono" fontSize={15} fill={C.soft} letterSpacing={1}>
              AZIMUT {fmtDeg(azDeg)}
            </text>
          </g>

          <g fontFamily="WaMono" fontSize={15} fill={C.soft} letterSpacing={1}>
            <text x={1016} y={1290} textAnchor="end">PLANCHE 1/1</text>
            <text x={1016} y={1266} textAnchor="end">ÉCH. 3:1</text>
            <text x={540} y={1290} textAnchor="middle">CALIBRE MÉCANIQUE · REMONTAGE MANUEL</text>
          </g>
          <Triad cam={cam} />

          {f >= IMPACT ? (
            <g>
              <text x={540} y={1110} textAnchor="middle" fontFamily="WaTitle" fontSize={64} fill={C.ink} opacity={endIn} transform={`translate(0, ${(1 - endIn) * 18})`} letterSpacing={-1}>
                Pas de pile.
              </text>
              <text x={540} y={1182} textAnchor="middle" fontFamily="WaTitle" fontSize={64} fill={C.accent} opacity={endIn2} transform={`translate(0, ${(1 - endIn2) * 18})`} letterSpacing={-1}>
                Juste un ressort.
              </text>
            </g>
          ) : null}
        </svg>
      </AbsoluteFill>
    </FontGate>
  );
};

const Triad: React.FC<{cam: Cam}> = ({cam}) => {
  const c: Cam = {...cam, scale: 1, cx: 0, cy: 0, cz: 0};
  const o = [92, 1222];
  const arm = (v: V3, label: string) => {
    const p = project(v, c);
    return (
      <g key={label}>
        <line x1={o[0]} y1={o[1]} x2={o[0] + p[0]} y2={o[1] + p[1]} stroke={C.ink} strokeWidth={1.5} />
        <text x={o[0] + p[0] * 1.35} y={o[1] + p[1] * 1.35 + 5} textAnchor="middle" fontFamily="WaMono" fontSize={13} fill={C.soft}>
          {label}
        </text>
      </g>
    );
  };
  return <g>{[arm([34, 0, 0], 'x'), arm([0, 34, 0], 'y'), arm([0, 0, 34], 'z')]}<circle cx={o[0]} cy={o[1]} r={3} fill={C.ink} /></g>;
};
