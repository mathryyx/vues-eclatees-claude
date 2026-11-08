import React, {useEffect, useMemo, useState} from 'react';
import {
  AbsoluteFill, Easing, Html5Audio, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {Cam, DrawItem, PartInstance, V3, project, renderPart, rotAround} from './engine';
import {C, FAN_C, PARTS, PartDef, fanOfPiece} from './model';

// ---------- rythme : 120 BPM, un temps = 15 images ----------
const BEAT = 15;
const SWEEP0 = 270; // surbrillance des repères, une croche chacun
const STEP = 7.5;
const LABEL_OUT0 = 380;
const LABEL_OUT1 = 392;
const COLLAPSE = 404; // début du remontage
const IMPACT = 420; // tout est remonté (temps 28)

const FONT_CSS = `
@font-face { font-family: 'GpuCond'; src: local('AvenirNextCondensed-DemiBold'), local('Avenir Next Condensed Demi Bold'); }
@font-face { font-family: 'GpuCondReg'; src: local('AvenirNextCondensed-Medium'), local('Avenir Next Condensed Medium'); }
@font-face { font-family: 'GpuTitle'; src: local('AvenirNext-Bold'), local('Avenir Next Bold'); }
@font-face { font-family: 'GpuMono'; src: local('Menlo-Regular'), local('Menlo'); }
@font-face { font-family: 'GpuMonoB'; src: local('Menlo-Bold'); }
`;
const FAMILIES = ['GpuCond', 'GpuCondReg', 'GpuTitle', 'GpuMono', 'GpuMonoB'];

const P = PARTS;

// départ de chaque pièce mobile
const START: Record<string, number> = {
  fans: 4 * BEAT,
  shroud: 5 * BEAT,
  fins: 6 * BEAT,
  pipes: 7 * BEAT,
  plate: 8 * BEAT,
  paste: 9 * BEAT,
  backplate: 10 * BEAT,
};
// composants restés sur le circuit imprimé : simple « sursaut » + teinte
const POP: Record<string, number> = {
  board: 11 * BEAT,
  gpu: 12 * BEAT,
  vram: 13 * BEAT,
  vrm: 14 * BEAT,
  pcie: 15 * BEAT,
  power: 16 * BEAT,
  outputs: 17 * BEAT,
};

interface LabelDef {
  n: string;
  name: string[];
  spec: string;
  part: PartDef;
  group?: string;
  side: 'L' | 'R';
  anchor: V3;
  start: number;
}
const LABELS: LabelDef[] = [
  {n: '01', name: ['Ventilateurs'], spec: "brassent l'air", part: P.fans, side: 'R', anchor: [262, -30, 74], start: START.fans},
  {n: '02', name: ['Carénage'], spec: "guide le flux d'air", part: P.shroud, side: 'L', anchor: [-262, -40, 64], start: START.shroud},
  {n: '03', name: ['Radiateur à ailettes'], spec: 'dissipe la chaleur', part: P.fins, side: 'R', anchor: [268, -92, 40], start: START.fins},
  {n: '04', name: ['Caloducs'], spec: 'évacuent la chaleur', part: P.pipes, side: 'L', anchor: [-250, -30, 48], start: START.pipes},
  {n: '05', name: ['Plaque de contact'], spec: 'capte la chaleur', part: P.plate, side: 'R', anchor: [0, -40, 15], start: START.plate},
  {n: '06', name: ['Pâte thermique'], spec: 'comble les micro-vides', part: P.paste, side: 'L', anchor: [-64, 2, 11], start: START.paste},
  {n: '07', name: ['Plaque arrière'], spec: 'rigidifie la carte', part: P.backplate, side: 'R', anchor: [196, -60, -8], start: START.backplate},
  {n: '08', name: ['Circuit imprimé'], spec: 'relie les composants', part: P.pcb, group: 'board', side: 'L', anchor: [-196, 72, 4], start: POP.board},
  {n: '09', name: ['Puce graphique (GPU)'], spec: 'calcule en parallèle', part: P.pcb, group: 'gpu', side: 'R', anchor: [-14, -26, 9.5], start: POP.gpu},
  {n: '10', name: ['Mémoire vidéo'], spec: 'stocke les données', part: P.pcb, group: 'vram', side: 'L', anchor: [-121, -26, 7], start: POP.vram},
  {n: '11', name: ["Étages d'alimentation"], spec: 'abaissent la tension', part: P.pcb, group: 'vrm', side: 'R', anchor: [90, -40, 15], start: POP.vrm},
  {n: '12', name: ['Connecteur PCIe'], spec: 'relié à la carte mère', part: P.pcb, group: 'pcie', side: 'L', anchor: [-186, -112, 4.6], start: POP.pcie},
  {n: '13', name: ['Connecteur', "d'alimentation"], spec: 'reçoit le courant', part: P.pcb, group: 'power', side: 'R', anchor: [175, 80, 21], start: POP.power},
  {n: '14', name: ['Sorties vidéo'], spec: 'vers les écrans', part: P.pcb, group: 'outputs', side: 'L', anchor: [-258, -62, 16], start: POP.outputs},
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// pièce -> groupe, pour le circuit imprimé
const groupOfPiece: string[] = [];
for (const [k, arr] of Object.entries(P.pcb.groups)) for (const p of arr) groupOfPiece[p] = k;

// étendue verticale locale de chaque partie
const minZ = new Map<PartDef, number>();
for (const part of Object.values(P)) minZ.set(part, Math.min(...part.geo.verts.map((v) => v[2])));

const collapseFactor = (f: number) => {
  if (f < COLLAPSE) return 1;
  if (f >= IMPACT) return 0;
  return 1 - Easing.in(Easing.cubic)((f - COLLAPSE) / (IMPACT - COLLAPSE));
};

const springAmt = (f: number, start: number, fps: number, soft = false) => {
  if (f < start) return 0;
  const config = soft ? {damping: 14, stiffness: 105, mass: 0.8} : {damping: 15, stiffness: 160, mass: 0.75};
  return spring({frame: f - start, fps, config}) * collapseFactor(f);
};

const amountOf = (part: PartDef, f: number, fps: number) => {
  const s = START[part.id];
  if (s === undefined) return 0;
  return springAmt(f, s, fps);
};

// rotation cumulée des ventilateurs (degrés)
const SPIN = (() => {
  const out: number[] = [0];
  for (let i = 1; i <= 460; i++) {
    let w = 13.5 * Easing.inOut(Easing.cubic)(clamp01((i - 2) / 40));
    if (i > IMPACT) w = 13.5 + 5 * Math.exp(-(i - IMPACT) / 10);
    out.push(out[i - 1] + w);
  }
  return out;
})();

// sursaut d'un composant : petit saut + teinte
const popLift = (t: number) => (t >= 0 && t < 12 ? Math.sin((Math.PI * t) / 12) * 16 : 0);
const popTint = (t: number) => (t >= 0 && t < 20 ? 0.85 * (1 - t / 20) : 0);

const sweepIndex = (f: number) => (f >= SWEEP0 && f < SWEEP0 + STEP * LABELS.length ? Math.floor((f - SWEEP0) / STEP) : -1);
const sweepK = (f: number) => 1 - ((f - SWEEP0) % STEP) / STEP;

const hopAt = (f: number) => (f >= 45 && f < 57 ? Math.sin((Math.PI * (f - 45)) / 12) * 12 : 0);

const makeXf = (part: PartDef, f: number, fps: number) => {
  const e = part.explode;
  const ph = (part.center[0] * 0.013 + part.center[2] * 0.021) % (Math.PI * 2);
  const hop = hopAt(f);
  const isFans = part.id === 'fans';
  const isPcb = part.id === 'pcb' || part.id === 'bracket';
  const amt = amountOf(part, f, fps);
  const fanAmt = isFans ? FAN_C.map((_, k) => springAmt(f, START.fans + (2 - k) * 3, fps, true)) : [];
  const spin = (SPIN[Math.min(SPIN.length - 1, Math.max(0, f))] * Math.PI) / 180;
  const boardHop = isPcb ? popLift(f - POP.board) * 0.5 : 0;
  return (p: V3, piece: number): V3 => {
    let a = amt;
    let q = p;
    if (isFans) {
      if (piece < 0) a = fanAmt[2];
      else {
        const k = fanOfPiece[piece] ?? 0;
        a = fanAmt[k];
        q = rotAround(q, [FAN_C[k][0], FAN_C[k][1], 0], 'z', spin);
      }
    }
    let lift = 0;
    if (part.id === 'pcb') {
      const gname = groupOfPiece[piece];
      if (gname && gname !== 'board') {
        let t = f - POP[gname];
        if (gname === 'vram') t -= (P.pcb.groups.vram.indexOf(piece) % 8) * 1.2;
        if (gname === 'vrm') t -= Math.floor(P.pcb.groups.vrm.indexOf(piece) / 2) * 0.8;
        lift = popLift(t);
      }
    }
    const bob = Math.sin((f / 60) * Math.PI * 2 + ph) * 3.5 * clamp01(a);
    if (part.wobble) {
      const wob = ((part.wobble.deg * Math.PI) / 180) * Math.sin(Math.PI * clamp01(a));
      if (wob) q = rotAround(q, part.center, part.wobble.axis, wob);
    }
    return [q[0] + e[0] * a, q[1] + e[1] * a, q[2] + e[2] * a + bob + hop + lift + boardHop];
  };
};

// ---------- caméra ----------
const S0 = 1.25;
const S1 = 1.2;
const CZ0 = 30;
const CZE = 290;
const camAt = (f: number): Cam => {
  const az = interpolate(f, [0, 450], [60, 22], {easing: Easing.inOut(Easing.sin)});
  const el = interpolate(f, [0, 225, 450], [30, 34, 31], {easing: Easing.inOut(Easing.sin)});
  let scale = interpolate(f, [0, 42, 84, 240, COLLAPSE], [S0, S0 * 0.98, 0.73, 0.71, 0.7], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateRight: 'clamp',
  });
  let cz = interpolate(f, [42, 86, 240], [CZ0, 262, CZE], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin)});
  if (f >= COLLAPSE) {
    const t = Easing.in(Easing.cubic)(clamp01((f - COLLAPSE) / (IMPACT - COLLAPSE)));
    scale = 0.7 + (S1 - 0.7) * t;
    cz = CZE + (CZ0 - CZE) * t;
  }
  if (f >= IMPACT) {
    const k = f - IMPACT;
    scale = S1 + 0.05 * Math.exp(-k / 4) * Math.cos(k * 0.9);
  }
  return {az: (az * Math.PI) / 180, el: (el * Math.PI) / 180, scale, cx: 540, cy: 690, cz};
};

const shakeAt = (f: number): [number, number] => {
  if (f < IMPACT) return [0, 0];
  const k = f - IMPACT;
  const a = 9 * Math.exp(-k / 3.5);
  return [a * Math.sin(k * 2.3), a * Math.cos(k * 3.1)];
};

// ---------- étiquettes ----------
const LEFT_X = 318;
const RIGHT_X = 762;
const LINE_H = 27;
const blockGap = (lines: number) => LINE_H * (lines - 1) + 60;
const layoutSide = (items: {y: number; lines: number}[], minY: number, maxY: number) => {
  const ord = items.map((it, i) => ({...it, i})).sort((a, b) => a.y - b.y);
  const pos = ord.map((o) => o.y);
  for (let k = 0; k < pos.length; k++) {
    const lo = k === 0 ? minY : pos[k - 1] + blockGap(ord[k - 1].lines);
    pos[k] = Math.max(pos[k], lo);
  }
  for (let k = pos.length - 1; k >= 0; k--) {
    const hiLim = k === pos.length - 1 ? maxY - LINE_H * (ord[k].lines - 1) : pos[k + 1] - blockGap(ord[k].lines);
    if (pos[k] > hiLim) pos[k] = hiLim;
  }
  const out = new Array(items.length).fill(0);
  ord.forEach((o, k) => (out[o.i] = pos[k]));
  return out;
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

const BASE_ORDER: PartDef[] = [P.backplate, P.pcb, P.paste, P.plate, P.pipes, P.fins, P.shroud, P.fans];
const BRACKET_TOP = 58;

export const Gpu: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const f = frame;

  const scene = useMemo(() => {
    const cam = camAt(f);
    const [shx, shy] = shakeAt(f);
    cam.cx += shx;
    cam.cy += shy;
    const hi = sweepIndex(f);
    const hiK = hi >= 0 ? sweepK(f) : 0;
    const hiLabel = hi >= 0 ? LABELS[hi] : null;

    // ordre de dessin : l'équerre passe devant ou derrière selon le côté vu
    const order = [...BASE_ORDER];
    if (cam.az < 0) order.splice(order.indexOf(P.pcb), 0, P.bracket);
    else {
      let at = order.indexOf(P.pcb) + 1;
      for (let i = at; i < order.length; i++) {
        const part = order[i];
        const zLow = minZ.get(part)! + part.explode[2] * amountOf(part, f, fps);
        if (zLow < BRACKET_TOP) at = i + 1;
      }
      order.splice(at, 0, P.bracket);
    }

    const items: DrawItem[] = [];
    for (const part of order) {
      const inst: PartInstance = {geo: part.geo, topo: part.topo, xf: makeXf(part, f, fps), tintColor: C.accent};
      if (hiLabel && hiLabel.part === part && !hiLabel.group) inst.tint = 0.55 * hiK;
      if (part.id === 'pcb') {
        inst.tintOf = (piece) => {
          const g = groupOfPiece[piece];
          if (!g) return 0;
          let t = popTint(f - POP[g]);
          if (g === 'board') t *= 0.45;
          if (hiLabel && hiLabel.group === g) t = Math.max(t, (g === 'board' ? 0.3 : 0.6) * hiK);
          return t;
        };
      }
      renderPart(inst, cam, items);
    }

    // axe mixte vertical (centre GPU) et axes des ventilateurs
    const axes: {a: [number, number]; b: [number, number]; dashed?: boolean}[] = [];
    const zOf = (part: PartDef, z: number) => z + part.explode[2] * amountOf(part, f, fps);
    const axis = (x: number, y: number, lo: number, hiZ: number, dashed?: boolean) => {
      if (hiZ - lo < 14) return;
      const a = project([x, y, lo], cam);
      const b = project([x, y, hiZ], cam);
      axes.push({a: [a[0], a[1]], b: [b[0], b[1]], dashed});
    };
    axis(-40, 0, zOf(P.backplate, -8), zOf(P.shroud, 64));
    FAN_C.forEach(([x, y], k) => {
      const a = springAmt(f, START.fans + (2 - k) * 3, fps, true);
      axis(x, y, zOf(P.shroud, 77), 77 + P.fans.explode[2] * a);
    });

    const lab = LABELS.map((L) => {
      const xf = makeXf(L.part, f, fps);
      const piece = L.group ? P.pcb.groups[L.group][0] : -1;
      const cur = project(xf(L.anchor, piece), cam);
      return {L, cur};
    });
    // mise en page sur la position « éclatée » (stable), calculée à amt = 1
    const ys = new Map<LabelDef, number>();
    const camE: Cam = {...camAt(Math.max(f, 250)), cx: cam.cx, cy: cam.cy};
    if (f >= COLLAPSE) Object.assign(camE, camAt(COLLAPSE - 1));
    const finY = (L: LabelDef) => {
      const p: V3 = [L.anchor[0], L.anchor[1], L.anchor[2] + L.part.explode[2]];
      return project(p, {...camE, az: cam.az, el: cam.el})[1];
    };
    for (const side of ['L', 'R'] as const) {
      const sel = LABELS.filter((L) => L.side === side);
      const pos = layoutSide(sel.map((L) => ({y: finY(L), lines: L.name.length})), 228, side === 'L' ? 1150 : 1210);
      sel.forEach((L, i) => ys.set(L, pos[i]));
    }
    // traînées de rotation sur les ventilateurs
    const arcs: {d: string; o: number}[] = [];
    const sp = f >= 1 ? SPIN[f] - SPIN[f - 1] : 0;
    const fanXf = makeXf(P.fans, f, fps);
    FAN_C.forEach(([cx, cy], k) => {
      const piece = fanOfPiece.indexOf(k);
      const o = clamp01((sp - 4) / 8) * 0.75;
      if (o <= 0.01) return;
      for (const [r, a0, len] of [[64, 0, 1.25], [64, 2.1, 1.25], [64, 4.2, 1.25], [44, 1.0, 1.0], [44, 3.1, 1.0], [44, 5.2, 1.0]] as const) {
        let d = '';
        for (let i = 0; i <= 10; i++) {
          const a = a0 + (i / 10) * len;
          const w = fanXf([cx + r * Math.cos(a), cy + r * Math.sin(a), 77.5], piece);
          const q = project(w, cam);
          d += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
        }
        arcs.push({d, o});
      }
    });
    return {cam, items, axes, lab, ys, hi, hiK, arcs};
  }, [f, fps]);

  const {cam, items, axes, lab, ys, hi, hiK, arcs} = scene;

  const count = LABELS.filter((L) => f >= L.start).length;
  const azDeg = (cam.az * 180) / Math.PI;

  const titleIn = interpolate(f, [-1, 0], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const endIn = interpolate(f, [IMPACT + 3, IMPACT + 13], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const endIn2 = interpolate(f, [IMPACT + 8, IMPACT + 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const burstT = f >= IMPACT ? (f - IMPACT) / 10 : -1;

  return (
    <FontGate>
      <AbsoluteFill style={{background: C.paper}}>
        <Html5Audio src={staticFile('gpu/gpu.wav')} />
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
            {items.map((it, i) => (
              <g key={i}>
                <path d={it.d} fill={it.fill} stroke={it.fill} strokeWidth={0.9} />
                {it.edges ? <path d={it.edges} fill="none" stroke={C.ink} strokeWidth={1.5} /> : null}
              </g>
            ))}
          </g>

          <g fill="none" stroke="#C9D3FF" strokeWidth={2.6} strokeLinecap="round">
            {arcs.map((a, i) => (
              <path key={i} d={a.d} opacity={a.o} />
            ))}
          </g>

          {burstT >= 0 && burstT <= 1 ? (
            <g stroke={C.ink} strokeWidth={2.2} strokeLinecap="round">
              {Array.from({length: 12}, (_, i) => {
                const a = (i / 12) * Math.PI * 2 + 0.2;
                const r0 = 340 + burstT * 90;
                const r1 = r0 + 40 * (1 - burstT);
                const cx = 540;
                const cy = 660;
                return (
                  <line key={i} x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0 * 0.62} x2={cx + Math.cos(a) * r1} y2={cy + Math.sin(a) * r1 * 0.62} opacity={1 - burstT} />
                );
              })}
            </g>
          ) : null}

          {lab.map(({L, cur}, li) => {
            const t = f - L.start;
            const lineP = interpolate(t, [5, 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
            const txtP = interpolate(t, [9, 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
            const out = interpolate(f, [LABEL_OUT0 + li * 0.6, LABEL_OUT1], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});
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
            const tx = left ? bx - 24 : bx + 24;
            const anchor = left ? 'end' : 'start';
            return (
              <g key={L.n}>
                <line x1={ax} y1={ay} x2={ex} y2={ey} stroke={C.ink} strokeWidth={1.4} />
                <circle cx={ax} cy={ay} r={4.6} fill={isHi ? C.accent : C.ink} stroke={C.paper} strokeWidth={1.6} />
                <g opacity={tp} transform={`translate(${shift},0)`}>
                  <circle cx={bx} cy={y} r={15 + k * 3} fill={isHi ? C.accent : C.paper} stroke={isHi ? C.accent : C.ink} strokeWidth={1.5} />
                  <text x={bx} y={y + 4.6} textAnchor="middle" fontFamily="GpuMonoB" fontSize={13} fill={isHi ? C.paper : C.ink}>
                    {L.n}
                  </text>
                  {L.name.map((line, j) => (
                    <text key={j} x={tx} y={y + 6 + j * LINE_H} textAnchor={anchor} fontFamily="GpuCond" fontSize={27} fill={C.ink} stroke={C.paper} strokeWidth={6} paintOrder="stroke">
                      {line}
                    </text>
                  ))}
                  <text x={tx} y={y + 30 + (L.name.length - 1) * LINE_H} textAnchor={anchor} fontFamily="GpuCondReg" fontSize={21} fill="#6A6F80" stroke={C.paper} strokeWidth={5} paintOrder="stroke">
                    {L.spec}
                  </text>
                </g>
              </g>
            );
          })}

          <g opacity={titleIn} transform={`translate(0, ${(1 - titleIn) * -14})`}>
            <text x={64} y={92} fontFamily="GpuMonoB" fontSize={17} fill={C.accent} letterSpacing={2}>
              FIG. 04 — VUE ÉCLATÉE
            </text>
            <text x={62} y={150} fontFamily="GpuTitle" fontSize={50} fill={C.ink} letterSpacing={-1}>
              Anatomie d'une carte graphique
            </text>
            <text x={1016} y={92} textAnchor="end" fontFamily="GpuMonoB" fontSize={17} fill={C.ink} letterSpacing={2}>
              REPÈRES {String(count).padStart(2, '0')}/{LABELS.length}
            </text>
          </g>

          <g fontFamily="GpuMono" fontSize={15} fill={C.soft} letterSpacing={1}>
            <text x={150} y={1290}>AZIMUT {fmtDeg(azDeg)}</text>
            <text x={1016} y={1290} textAnchor="end">PLANCHE 1/1</text>
          </g>
          <Triad cam={cam} />

          {f >= IMPACT ? (
            <g>
              <text x={540} y={1110} textAnchor="middle" fontFamily="GpuTitle" fontSize={66} fill={C.ink} opacity={endIn} transform={`translate(0, ${(1 - endIn) * 18})`} letterSpacing={-1}>
                Ce qui fait
              </text>
              <text x={540} y={1184} textAnchor="middle" fontFamily="GpuTitle" fontSize={66} fill={C.accent} opacity={endIn2} transform={`translate(0, ${(1 - endIn2) * 18})`} letterSpacing={-1}>
                tourner l'IA.
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
  const o = [92, 1236];
  const arm = (v: V3, label: string) => {
    const p = project(v, c);
    return (
      <g key={label}>
        <line x1={o[0]} y1={o[1]} x2={o[0] + p[0]} y2={o[1] + p[1]} stroke={C.ink} strokeWidth={1.5} />
        <text x={o[0] + p[0] * 1.35} y={o[1] + p[1] * 1.35 + 5} textAnchor="middle" fontFamily="GpuMono" fontSize={13} fill={C.soft}>
          {label}
        </text>
      </g>
    );
  };
  return <g>{[arm([34, 0, 0], 'x'), arm([0, 34, 0], 'y'), arm([0, 0, 34], 'z')]}<circle cx={o[0]} cy={o[1]} r={3} fill={C.ink} /></g>;
};
