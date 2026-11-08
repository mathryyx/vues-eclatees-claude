import React, {useEffect, useMemo, useState} from 'react';
import {
  AbsoluteFill, Easing, Html5Audio, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {Cam, DrawItem, Part, V3, bboxPart, project, renderPart, rotX} from './engine';
import {
  C, CAM_X, CAP_B, CAP_H, CLIP_X, CR, D2R, DRIVER_L, HUB_A_X, HUB_B_X, KEY_PIN_L, KEY_TIP, KT, LEN, PARTS, PIN_X, PR, REST, RP, RS, TOP,
  keyTop,
} from './model';

// ---------- rythme : 120 BPM, un temps = 15 images ----------
const BEAT = 15;
const STEP_F = [30, 45, 60, 75, 90]; // la clé avance d'un cran par temps
const STEP_U = [21.5, 16, 12, 8, 4, 0];
const STEP_DUR = 9;
const CHECK_F = [105, 112.5, 120, 127.5, 135];
const TURN = [150, 165];
const BACK = [195, 207];
const EXPLODE0 = 210;
const RETRACT = [397, 405];
const COLLAPSE = 405;
const IMPACT = 420;

type Slot = 'caps' | 'springs' | 'drivers' | 'clip' | 'cam' | 'rotor' | 'keyPins' | 'key' | 'stator';
const SLOTS: Slot[] = ['caps', 'springs', 'drivers', 'clip', 'cam', 'rotor', 'keyPins', 'key', 'stator'];
const slotStart = (s: Slot) => EXPLODE0 + SLOTS.indexOf(s) * BEAT;

const FONT_CSS = `
@font-face { font-family: 'LkCond'; src: local('AvenirNextCondensed-DemiBold'), local('Avenir Next Condensed Demi Bold'); }
@font-face { font-family: 'LkTitle'; src: local('AvenirNext-Bold'), local('Avenir Next Bold'); }
@font-face { font-family: 'LkMono'; src: local('Menlo-Regular'), local('Menlo'); }
@font-face { font-family: 'LkMonoB'; src: local('Menlo-Bold'); }
`;
const FAMILIES = ['LkCond', 'LkTitle', 'LkMono', 'LkMonoB'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = Easing.inOut(Easing.cubic);

// ---------- état mécanique ----------
interface State {
  u: number; // retrait de la clé (0 = enfoncée)
  theta: number; // rotation du rotor (rad)
  a: Record<Slot, number>; // éclatement 0..1
  pinB: number[]; // bas des goupilles de clé (repère rotor)
}

const keyU = (f: number) => {
  if (f < STEP_F[0]) return interpolate(f, [0, 27], [66, STEP_U[0]], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  let u = STEP_U[0];
  STEP_F.forEach((s, i) => {
    const t = clamp01((f - s) / STEP_DUR);
    if (t > 0) u = STEP_U[i] + (STEP_U[i + 1] - STEP_U[i]) * ease(t);
  });
  return u;
};

const pinBottoms = (u: number) =>
  PIN_X.map((x) => {
    const lx = x + u;
    if (lx > KEY_TIP || lx < 0) return REST;
    return Math.max(REST, keyTop(lx));
  });

const collapseFactor = (f: number) => {
  if (f < COLLAPSE) return 1;
  if (f >= IMPACT) return 0;
  return 1 - Easing.in(Easing.cubic)((f - COLLAPSE) / (IMPACT - COLLAPSE));
};

const thetaAt = (f: number) => {
  if (f < TURN[0]) return 0;
  if (f < TURN[1]) return -90 * D2R * ease((f - TURN[0]) / (TURN[1] - TURN[0]));
  if (f < BACK[0]) return -90 * D2R;
  if (f < BACK[1]) return -90 * D2R * (1 - ease((f - BACK[0]) / (BACK[1] - BACK[0])));
  return 0;
};

const stateAt = (f: number, fps: number): State => {
  const u = keyU(f);
  const a = {} as Record<Slot, number>;
  const cf = collapseFactor(f);
  for (const s of SLOTS) {
    const st = slotStart(s);
    a[s] = f < st ? 0 : spring({frame: f - st, fps, config: {damping: 15, stiffness: 160, mass: 0.7}}) * cf;
  }
  return {u, theta: thetaAt(f), a, pinB: pinBottoms(u)};
};

// ---------- scène ----------
interface Item {
  part: Part;
  xf: (p: V3) => V3;
  cull?: (c: V3, f: {tag?: string}) => boolean;
  tint?: number;
}

const OFF = {caps: 25, springs: 18.5, drivers: 16.5, clip: 15, cam: 8, rotor: -36, keyPins: 11, key: -30};
const FREE = 11.5;

const sceneOf = (S: State) => {
  const th = S.theta;
  const rx = OFF.rotor * S.a.rotor;
  const rot = (p: V3, dx: number): V3 => {
    const q = rotX(p, th);
    return [q[0] + dx, q[1], q[2]];
  };
  const back: {x: number; it: Item}[] = [];
  const camDx = OFF.cam * S.a.cam;
  const clipDx = OFF.clip * S.a.clip;
  back.push({x: CAM_X + 1.25 + camDx, it: {part: PARTS.cam, xf: (p) => rot([p[0] + CAM_X, p[1], p[2]], camDx)}});
  back.push({x: HUB_A_X + 0.35 + camDx, it: {part: PARTS.hubA, xf: (p) => rot([p[0] + HUB_A_X, p[1], p[2]], camDx)}});
  back.push({x: HUB_B_X + 0.4 + camDx, it: {part: PARTS.hubB, xf: (p) => rot([p[0] + HUB_B_X, p[1], p[2]], camDx)}});
  back.push({x: CLIP_X + 0.5 + clipDx, it: {part: PARTS.clip, xf: (p) => rot([p[0] + CLIP_X, p[1], p[2]], clipDx)}});
  back.sort((p, q) => q.x - p.x);

  const items: Item[] = back.map((b) => b.it);
  items.push({part: PARTS.stator, xf: (p) => p});
  items.push({
    part: PARTS.rotor,
    xf: (p) => rot(p, rx),
    cull: (c, f) => f.tag === 'outer' && c[1] > 0.05 && c[0] > 0.2 && c[0] < LEN - 0.2,
  });
  items.push({part: PARTS.key, xf: (p) => rot([p[0] - S.u + OFF.key * S.a.key, p[1], p[2]], rx)});
  // goupilles de clé : dans le rotor
  const kpRise = OFF.keyPins * S.a.keyPins;
  PARTS.keyPins.forEach((P, j) => {
    items.push({part: P, xf: (p) => rot([p[0] + PIN_X[j], p[1], p[2] + S.pinB[j] + kpRise], rx)});
  });
  // contre-goupilles : dans le stator, posées sur la goupille de clé (ou sur la ligne de cisaillement si le rotor a tourné)
  const drvRise = OFF.drivers * S.a.drivers;
  const drvBottom0 = S.pinB.map((b, j) => (Math.abs(th) > 1e-4 ? RP : b + KEY_PIN_L[j]));
  PARTS.drivers.forEach((P, j) => {
    items.push({part: P, xf: (p) => [p[0] + PIN_X[j], p[1], p[2] + drvBottom0[j] + drvRise]});
  });
  const capB = CAP_B + OFF.caps * S.a.caps;
  const springs = drvBottom0.map((b) => {
    const z0 = b + DRIVER_L + OFF.springs * S.a.springs;
    const z1 = Math.min(capB, z0 + FREE);
    return [z0, z1] as [number, number];
  });
  const caps: Item[] = PARTS.caps.map((P, j) => ({part: P, xf: (p: V3) => [p[0] + PIN_X[j], p[1], p[2] + capB] as V3}));
  const keyXf = items[back.length + 2].xf;
  const rotXf = items[back.length + 1].xf;
  const kp = (j: number) => items[back.length + 3 + j].xf;
  const dv = (j: number) => items[back.length + 8 + j].xf;
  const anchors: Record<Slot, V3> = {
    caps: caps[0].xf([-CR * 0.7, -CR * 0.7, 1.2]),
    springs: [PIN_X[0] - 0.9, -0.9, (springs[0][0] + springs[0][1]) / 2],
    drivers: dv(0)([-PR * 0.7, -PR * 0.7, DRIVER_L / 2]),
    clip: rot([CLIP_X + 0.5, 0, 5.4], clipDx),
    cam: rot([CAM_X + 1.25, 0, -13], camDx),
    rotor: rotXf([13, 0, -RP]),
    keyPins: kp(0)([-PR * 0.7, -PR * 0.7, KEY_PIN_L[0] / 2]),
    key: keyXf([12, -KT, -5]),
    stator: [16, 0, -RS + 0.6],
  };
  // rotor tourné au-delà de 45° : la clé passe devant les goupilles de clé
  const order = [...items];
  if (th < -45 * D2R) {
    const keyIt = order.splice(back.length + 2, 1)[0];
    order.splice(back.length + 7, 0, keyIt);
  }
  return {items: order, springs, caps, rx, anchors, kp, dv};
};

// ---------- ressorts ----------
const springPaths = (x: number, z0: number, z1: number, cam: Cam) => {
  const turns = 7;
  const r = 1.22;
  const n = turns * 18;
  let backD = '';
  let frontD = '';
  let prevFront: boolean | null = null;
  let prev: V3 | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const p: V3 = [x + r * Math.cos(a), r * Math.sin(a), z0 + (z1 - z0) * t];
    const s = project(p, cam);
    const isFront = p[1] < 0;
    if (prev) {
      const seg = `M${prev[0].toFixed(1)} ${prev[1].toFixed(1)}L${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
      if (isFront || prevFront) frontD += seg;
      else backD += seg;
    }
    prev = s;
    prevFront = isFront;
  }
  return {backD, frontD};
};

// ---------- caméra ----------
const CAM_A = {az: 30, el: 24};
const CAM_B = {az: 50, el: 29};
const CAM_C = {az: 33, el: 25};

const fit = (az: number, el: number, states: State[], rect: [number, number, number, number]) => {
  const cam: Cam = {az: az * D2R, el: el * D2R, scale: 1, tx: 0, ty: 0, tz: 0, cx: 0, cy: 0};
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const S of states) {
    const sc = sceneOf(S);
    for (const it of [...sc.items, ...sc.caps]) bboxPart(it.part, it.xf, cam, bb);
  }
  const w = bb[2] - bb[0];
  const h = bb[3] - bb[1];
  const scale = Math.min((rect[2] - rect[0]) / w, (rect[3] - rect[1]) / h);
  const mx = (bb[0] + bb[2]) / 2;
  const my = (bb[1] + bb[3]) / 2;
  return {scale, cx: (rect[0] + rect[2]) / 2 - mx * scale, cy: (rect[1] + rect[3]) / 2 - my * scale};
};

const zeroA = (): Record<Slot, number> => Object.fromEntries(SLOTS.map((s) => [s, 0])) as Record<Slot, number>;
const oneA = (): Record<Slot, number> => Object.fromEntries(SLOTS.map((s) => [s, 1])) as Record<Slot, number>;
const S_IN: State = {u: 0, theta: 0, a: zeroA(), pinB: pinBottoms(0)};
const S_TURN: State = {u: 0, theta: -90 * D2R, a: zeroA(), pinB: pinBottoms(0)};
const S_EXP: State = {u: 0, theta: 0, a: oneA(), pinB: pinBottoms(0)};
const FIT_A = fit(CAM_A.az, CAM_A.el, [S_IN, S_TURN], [70, 300, 1010, 1170]);
const FIT_B = fit(CAM_B.az, CAM_B.el, [S_EXP], [90, 250, 1000, 1140]);
const FIT_C = fit(CAM_C.az, CAM_C.el, [S_IN], [110, 250, 970, 1010]);

const camAt = (f: number): Cam => {
  const tB = ease(clamp01((f - 186) / 44));
  let az = CAM_A.az + (CAM_B.az - CAM_A.az) * tB + interpolate(f, [0, 200], [-3, 2], {extrapolateRight: 'clamp'}) * (1 - tB);
  let el = CAM_A.el + (CAM_B.el - CAM_A.el) * tB;
  let scale = FIT_A.scale + (FIT_B.scale - FIT_A.scale) * tB;
  let cx = FIT_A.cx + (FIT_B.cx - FIT_A.cx) * tB;
  let cy = FIT_A.cy + (FIT_B.cy - FIT_A.cy) * tB;
  if (f >= COLLAPSE) {
    const t = Easing.in(Easing.cubic)(clamp01((f - COLLAPSE) / (IMPACT - COLLAPSE)));
    az = CAM_B.az + (CAM_C.az - CAM_B.az) * t;
    el = CAM_B.el + (CAM_C.el - CAM_B.el) * t;
    scale = FIT_B.scale + (FIT_C.scale - FIT_B.scale) * t;
    cx = FIT_B.cx + (FIT_C.cx - FIT_B.cx) * t;
    cy = FIT_B.cy + (FIT_C.cy - FIT_B.cy) * t;
  }
  if (f >= IMPACT) {
    const k = f - IMPACT;
    az = CAM_C.az + (f - IMPACT) * 0.04;
    el = CAM_C.el;
    const s = 1 + 0.035 * Math.exp(-k / 4) * Math.cos(k * 0.9);
    scale = FIT_C.scale * s;
    cx = 540 + (FIT_C.cx - 540) * s;
    cy = 640 + (FIT_C.cy - 640) * s;
  }
  return {az: az * D2R, el: el * D2R, scale, tx: 0, ty: 0, tz: 0, cx, cy};
};

const shakeAt = (f: number): [number, number] => {
  const hit = (t0: number, amp: number) => {
    if (f < t0) return [0, 0];
    const k = f - t0;
    const a = amp * Math.exp(-k / 3);
    return [a * Math.sin(k * 2.3), a * Math.cos(k * 3.1)];
  };
  const out = [0, 0];
  for (const [t0, amp] of [[99, 3], [165, 4], [IMPACT, 9]] as [number, number][]) {
    const h = hit(t0, amp);
    out[0] += h[0];
    out[1] += h[1];
  }
  return out as [number, number];
};

// ---------- décor ----------
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

const Draw: React.FC<{items: DrawItem[]}> = ({items}) => (
  <g strokeLinejoin="round" strokeLinecap="round">
    {items.map((it, i) =>
      it.d ? (
        <g key={i}>
          <path d={it.d} fill={it.fill} stroke={it.fill} strokeWidth={0.8} fillRule="evenodd" />
          {it.hatch ? <path d={it.d} fill={`url(#hatch${it.hatch})`} fillRule="evenodd" /> : null}
          {it.edges ? <path d={it.edges} fill="none" stroke={C.ink} strokeWidth={1.6 * it.ew} /> : null}
        </g>
      ) : (
        <path key={i} d={it.edges} fill="none" stroke={it.stroke ?? C.ink} strokeWidth={it.ew} />
      ),
    )}
  </g>
);

// ---------- étiquettes ----------
interface LabelDef {
  n: string;
  name: string;
  spec: string;
  slot: Slot;
  side: 'L' | 'R';
  pos: [number, number]; // position finale de la pastille (vue éclatée posée)
}
const LABELS: LabelDef[] = [
  {n: '01', name: 'Bouchons', spec: '×5 · ferment les chambres', slot: 'caps', side: 'L', pos: [600, 300]},
  {n: '02', name: 'Ressorts', spec: '×5 · poussent les goupilles', slot: 'springs', side: 'L', pos: [600, 400]},
  {n: '03', name: 'Contre-goupilles', spec: '×5 · longueur unique', slot: 'drivers', side: 'L', pos: [600, 505]},
  {n: '04', name: 'Circlip', spec: 'clip de retenue', slot: 'clip', side: 'L', pos: [1000, 470]},
  {n: '05', name: 'Came', spec: 'entraîne le pêne', slot: 'cam', side: 'L', pos: [950, 900]},
  {n: '06', name: 'Rotor (barillet)', spec: 'tourne avec la clé', slot: 'rotor', side: 'R', pos: [560, 1080]},
  {n: '07', name: 'Goupilles de clé', spec: '×5 · longueurs variables', slot: 'keyPins', side: 'L', pos: [400, 610]},
  {n: '08', name: 'Clé', spec: 'denture · 5 crans', slot: 'key', side: 'R', pos: [380, 1170]},
  {n: '09', name: 'Stator (corps)', spec: 'fixe · profil européen', slot: 'stator', side: 'R', pos: [700, 990]},
];
const SHEAR_LABEL = {side: 'L' as const, name: 'Ligne de cisaillement', spec: 'jonction rotor / stator', pos: [1000, 340] as [number, number]};
// décalages des étiquettes, calculés une fois sur l'état posé
const finalAnchors = (st: State, fr: number) => {
  const cam = camAt(fr);
  const sc = sceneOf(st);
  return {cam, sc};
};
const LABEL_OFF: Record<string, [number, number]> = (() => {
  const {cam, sc} = finalAnchors(S_EXP, 360);
  const out: Record<string, [number, number]> = {};
  for (const L of LABELS) {
    const a = project(sc.anchors[L.slot], cam);
    out[L.n] = [L.pos[0] - a[0], L.pos[1] - a[1]];
  }
  const c2 = camAt(120);
  const a = project([LEN + 6, 0, RP], c2);
  out.shear = [SHEAR_LABEL.pos[0] - a[0], SHEAR_LABEL.pos[1] - a[1]];
  return out;
})();

const COUNTS: Record<Slot, number> = {caps: 5, springs: 5, drivers: 5, clip: 1, cam: 1, rotor: 1, keyPins: 5, key: 0, stator: 1};

const Label: React.FC<{
  ax: number; ay: number; off: [number, number]; side: 'L' | 'R'; n?: string; name: string; spec: string; lp: number; tp: number; hi?: number; accent?: boolean;
}> = ({ax, ay, off, side, n, name, spec, lp, tp, hi = 0, accent}) => {
  if (lp <= 0.001) return null;
  const bx = ax + off[0];
  const by = ay + off[1];
  const right = side === 'R';
  const r = n ? 15 : 6;
  const L = Math.hypot(off[0], off[1]) || 1;
  const sx = bx - (off[0] / L) * r;
  const sy = by - (off[1] / L) * r;
  const ex = ax + (sx - ax) * lp;
  const ey = ay + (sy - ay) * lp;
  const shift = (1 - tp) * 22 * (right ? -1 : 1);
  const tx = right ? bx + r + 10 : bx - r - 10;
  const col = accent ? C.accent : C.ink;
  return (
    <g>
      <line x1={ax} y1={ay} x2={ex} y2={ey} stroke={col} strokeWidth={1.5} />
      <circle cx={ax} cy={ay} r={4.6} fill={col} stroke={C.paper} strokeWidth={1.6} />
      <g opacity={tp} transform={`translate(${shift},0)`}>
        {n ? (
          <>
            <circle cx={bx} cy={by} r={15 + hi * 3} fill={hi > 0 ? C.accent : C.paper} stroke={hi > 0 ? C.accent : C.ink} strokeWidth={1.5} />
            <text x={bx} y={by + 4.6} textAnchor="middle" fontFamily="LkMonoB" fontSize={13} fill={hi > 0 ? C.paper : C.ink}>
              {n}
            </text>
          </>
        ) : (
          <circle cx={bx} cy={by} r={6} fill={C.accent} />
        )}
        <text x={tx} y={by - 3} textAnchor={right ? 'start' : 'end'} fontFamily="LkCond" fontSize={26} fill={accent ? C.accent : C.ink} stroke={C.paper} strokeWidth={5} paintOrder="stroke">
          {name}
        </text>
        <text x={tx} y={by + 21} textAnchor={right ? 'start' : 'end'} fontFamily="LkMono" fontSize={15} fill={C.soft} stroke={C.paper} strokeWidth={4} paintOrder="stroke">
          {spec}
        </text>
      </g>
    </g>
  );
};

const Check: React.FC<{x: number; y: number; s: number; color: string}> = ({x, y, s, color}) => (
  <path d={`M${x - 6 * s} ${y + 0.5 * s}L${x - 1.5 * s} ${y + 5 * s}L${x + 6.5 * s} ${y - 5 * s}`} fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
);

const Triad: React.FC<{cam: Cam}> = ({cam}) => {
  const c: Cam = {...cam, scale: 1, cx: 0, cy: 0, tx: 0, ty: 0, tz: 0};
  const o = [92, 1222];
  const arm = (v: V3, label: string) => {
    const p = project(v, c);
    return (
      <g key={label}>
        <line x1={o[0]} y1={o[1]} x2={o[0] + p[0]} y2={o[1] + p[1]} stroke={C.ink} strokeWidth={1.5} />
        <text x={o[0] + p[0] * 1.35} y={o[1] + p[1] * 1.35 + 5} textAnchor="middle" fontFamily="LkMono" fontSize={13} fill={C.soft}>
          {label}
        </text>
      </g>
    );
  };
  return <g>{[arm([34, 0, 0], 'x'), arm([0, 34, 0], 'y'), arm([0, 0, 34], 'z')]}<circle cx={o[0]} cy={o[1]} r={3} fill={C.ink} /></g>;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const lerpIn = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});

export const Lock: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const scene = useMemo(() => {
    const cam = camAt(f);
    const [shx, shy] = shakeAt(f);
    cam.cx += shx;
    cam.cy += shy;
    const S = stateAt(f, fps);
    const sc = sceneOf(S);
    // éclairs : goupille soulevée (montée), puis vérification sur la ligne
    const flash = PIN_X.map((_, j) => {
      const a = f >= STEP_F[j] ? Math.exp(-(f - STEP_F[j]) / 5) * 0.55 : 0;
      const b = f >= CHECK_F[j] ? Math.exp(-(f - CHECK_F[j]) / 4) * 0.6 : 0;
      return Math.max(a, b);
    });
    const items: DrawItem[] = [];
    sc.items.forEach((it) => {
      let k = PARTS.keyPins.indexOf(it.part);
      if (k < 0) k = PARTS.drivers.indexOf(it.part);
      const tint = k >= 0 ? flash[k] : 0;
      renderPart(it.part, cam, {xf: it.xf, cull: it.cull, tint, tintColor: '#FFFFFF'}, items);
    });
    const springs = sc.springs.map(([z0, z1], j) => springPaths(PIN_X[j], z0, z1, cam));
    const capItems: DrawItem[] = [];
    for (const it of sc.caps) renderPart(it.part, cam, {xf: it.xf}, capItems);
    const sl0 = project([-4, 0, RP], cam);
    const sl1 = project([LEN + 8, 0, RP], cam);
    const shearA = project([LEN + 6, 0, RP], cam);
    const anchors = Object.fromEntries(SLOTS.map((s) => [s, project(sc.anchors[s], cam)])) as Record<Slot, V3>;
    const tags = PIN_X.map((x) => project([x, 0, TOP + 5], cam));
    const gaps = PIN_X.map((x) => [project([x - 2.4, -PR, RP], cam), project([x + 2.4, -PR, RP], cam)]);
    const center = project([12, 0, 4], cam);
    // traits d'axe (mixtes) de la vue éclatée
    const A = S.a;
    const axes: {a: V3; b: V3; op: number}[] = [];
    const ax = (p: V3, q: V3, op: number) => {
      if (op > 0.01) axes.push({a: project(p, cam), b: project(q, cam), op});
    };
    const xL = -24 + OFF.rotor * A.rotor + OFF.key * A.key;
    const xR = CLIP_X + 3 + OFF.clip * A.clip;
    ax([xL, 0, 0], [xR, 0, 0], clamp01(Math.max(A.clip, A.rotor) * 1.5));
    const xm = PIN_X[2];
    ax([xm, 0, TOP - 3], [xm, 0, CAP_B + CAP_H + OFF.caps * A.caps + 3], clamp01(A.drivers * 1.5));
    const kTop = S.pinB[2] + KEY_PIN_L[2] + OFF.keyPins * A.keyPins + 3;
    ax([xm + OFF.rotor * A.rotor, 0, RP - 1], [xm + OFF.rotor * A.rotor, 0, kTop], clamp01(A.keyPins * 1.5));
    return {cam, S, items, springs, capItems, sl0, sl1, shearA, anchors, tags, gaps, center, axes};
  }, [f, fps]);
  const {cam, items, springs, capItems, sl0, sl1, shearA, anchors, tags, gaps, center, axes} = scene;

  // ligne de cisaillement et son étiquette (phase coupe)
  const shearOp = interpolate(f, [6, 16, 198, 210], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const shearLp = lerpIn(f, 10, 20) * (1 - lerpIn(f, 196, 206));
  const shearTp = lerpIn(f, 15, 25) * (1 - lerpIn(f, 194, 204));

  // pastilles 1..5 au-dessus des chambres
  const tagOut = 1 - lerpIn(f, 190, 202);

  // compteurs
  const checks = CHECK_F.filter((c) => f >= c).length;
  const shown = SLOTS.filter((s) => f >= slotStart(s) + 11).length;
  const pieces = SLOTS.filter((s) => f >= slotStart(s)).reduce((n, s) => n + COUNTS[s], 0);
  const deg = Math.round(-scene.S.theta / D2R);
  const unlocked = f >= 142;

  // surbrillance : une étiquette par croche (images 330 -> 397)
  const HL0 = 330;
  const hiIdx = f >= HL0 && f < HL0 + 9 * 7.5 ? Math.floor((f - HL0) / 7.5) : -1;
  const retract = 1 - interpolate(f, RETRACT, [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});

  const endIn = lerpIn(f, IMPACT + 3, IMPACT + 14);
  const endIn2 = lerpIn(f, IMPACT + 9, IMPACT + 20);
  const burstT = f >= IMPACT ? (f - IMPACT) / 10 : -1;

  return (
    <FontGate>
      <AbsoluteFill style={{background: C.paper}}>
        <Html5Audio src={staticFile('lock/lock.wav')} />
        <svg width={1080} height={1350} viewBox="0 0 1080 1350" style={{position: 'absolute', inset: 0}}>
          <defs>
            <pattern id="hatchA" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={8} stroke={C.ink} strokeWidth={1.1} strokeOpacity={0.5} />
            </pattern>
            <pattern id="hatchB" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <line x1={0} y1={0} x2={0} y2={8} stroke={C.ink} strokeWidth={1.1} strokeOpacity={0.5} />
            </pattern>
          </defs>
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
              <line key={i} x1={a.a[0]} y1={a.a[1]} x2={a.b[0]} y2={a.b[1]} strokeDasharray="16 5 3 5" opacity={a.op} />
            ))}
          </g>
          <Draw items={items} />
          <g strokeLinecap="round">
            {springs.map((s, j) => (
              <g key={j}>
                <path d={s.backD} fill="none" stroke={C.soft} strokeWidth={1.6} />
                <path d={s.frontD} fill="none" stroke={C.spring} strokeWidth={3.8} />
                <path d={s.frontD} fill="none" stroke="#DDE1EA" strokeWidth={1.7} />
              </g>
            ))}
          </g>
          <Draw items={capItems} />

          {/* ligne de cisaillement */}
          {shearOp > 0 ? (
            <line x1={sl0[0]} y1={sl0[1]} x2={sl1[0]} y2={sl1[1]} stroke={C.accent} strokeWidth={2.4} strokeDasharray="14 6 3 6" opacity={shearOp} />
          ) : null}

          {/* contrôle d'alignement sur la ligne */}
          {gaps.map(([a, b], j) => {
            const t = f - CHECK_F[j];
            if (t < 0 || f > 210) return null;
            const p = lerpIn(f, CHECK_F[j], CHECK_F[j] + 5) * (1 - lerpIn(f, 150, 158));
            const ring = clamp01(t / 10);
            const mx = (a[0] + b[0]) / 2;
            const my = (a[1] + b[1]) / 2;
            return (
              <g key={j} opacity={p}>
                {ring < 1 ? <circle cx={mx} cy={my} r={10 + ring * 34} fill="none" stroke={C.accent} strokeWidth={2.5 * (1 - ring)} /> : null}
                <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={C.paper} strokeWidth={8} strokeLinecap="round" />
                <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={C.accent} strokeWidth={4.5} strokeLinecap="round" />
              </g>
            );
          })}

          {/* pastilles des chambres */}
          {tags.map((p, j) => {
            if (f < STEP_F[j] || tagOut <= 0) return null;
            const pop = spring({frame: f - STEP_F[j], fps, config: {damping: 11, stiffness: 220, mass: 0.6}});
            const ok = f >= CHECK_F[j];
            const okPop = ok ? spring({frame: f - CHECK_F[j], fps, config: {damping: 10, stiffness: 240, mass: 0.5}}) : 0;
            const r = 15 * pop * tagOut * (1 + 0.25 * Math.sin(Math.PI * clamp01(okPop)));
            return (
              <g key={j}>
                <line x1={p[0]} y1={p[1] + r} x2={p[0]} y2={p[1] + 24 * pop * tagOut} stroke={ok ? C.accent : C.ink} strokeWidth={1.4} />
                <circle cx={p[0]} cy={p[1]} r={r} fill={ok ? C.accent : C.paper} stroke={ok ? C.accent : C.ink} strokeWidth={1.5} />
                {ok ? (
                  <Check x={p[0]} y={p[1]} s={0.95 * pop * tagOut} color={C.paper} />
                ) : (
                  <text x={p[0]} y={p[1] + 4.6} textAnchor="middle" fontFamily="LkMonoB" fontSize={13 * pop * tagOut} fill={C.ink}>
                    {j + 1}
                  </text>
                )}
              </g>
            );
          })}

          <Label ax={shearA[0]} ay={shearA[1]} off={LABEL_OFF.shear} side="L" name={SHEAR_LABEL.name} spec={SHEAR_LABEL.spec} lp={shearLp} tp={shearTp} accent />

          {/* éclat d'impact */}
          {burstT >= 0 && burstT <= 1 ? (
            <g stroke={C.ink} strokeWidth={2.2} strokeLinecap="round">
              {Array.from({length: 12}, (_, i) => {
                const a = (i / 12) * Math.PI * 2 + 0.2;
                const r0 = 300 + burstT * 90;
                const r1 = r0 + 40 * (1 - burstT);
                return (
                  <line key={i} x1={center[0] + Math.cos(a) * r0} y1={center[1] + Math.sin(a) * r0 * 0.7} x2={center[0] + Math.cos(a) * r1} y2={center[1] + Math.sin(a) * r1 * 0.7} opacity={1 - burstT} />
                );
              })}
            </g>
          ) : null}

          {/* étiquettes de la vue éclatée */}
          {LABELS.map((L, li) => {
            const t = f - slotStart(L.slot);
            const lp = interpolate(t, [6, 15], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)}) * retract;
            const tp = interpolate(t, [11, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)}) * retract;
            const a = anchors[L.slot];
            const hi = li === hiIdx ? 1 - ((f - HL0) % 7.5) / 7.5 : 0;
            return <Label key={L.n} ax={a[0]} ay={a[1]} off={LABEL_OFF[L.n]} side={L.side} n={L.n} name={L.name} spec={L.spec} lp={lp} tp={tp} hi={li === hiIdx ? Math.max(0.01, hi) : 0} />;
          })}

          {/* en-tête */}
          <g>
            <text x={64} y={92} fontFamily="LkMonoB" fontSize={17} fill={C.accent} letterSpacing={2}>
              {f < EXPLODE0 || f >= IMPACT ? 'FIG. 02 — VUE EN COUPE A-A' : 'FIG. 02 — VUE ÉCLATÉE'}
            </text>
            <text x={62} y={150} fontFamily="LkTitle" fontSize={54} fill={C.ink} letterSpacing={-1}>
              Anatomie d'une serrure
            </text>
            {f < EXPLODE0 ? (
              <>
                <text x={1016} y={92} textAnchor="end" fontFamily="LkMonoB" fontSize={17} fill={unlocked ? C.accent : C.ink} letterSpacing={2}>
                  {unlocked ? 'DÉVERROUILLÉ' : 'VERROUILLÉ'}
                </text>
                <text x={1016} y={118} textAnchor="end" fontFamily="LkMono" fontSize={15} fill={C.soft} letterSpacing={1}>
                  {unlocked ? `ROTATION ${deg > 0 ? '+' : ''}${pad2(deg)}°` : `ALIGNÉES ${checks}/5`}
                </text>
              </>
            ) : (
              <>
                <text x={1016} y={92} textAnchor="end" fontFamily="LkMonoB" fontSize={17} fill={C.ink} letterSpacing={2}>
                  REPÈRES {pad2(shown)}/09
                </text>
                <text x={1016} y={118} textAnchor="end" fontFamily="LkMono" fontSize={15} fill={C.soft} letterSpacing={1}>
                  PIÈCES {pad2(pieces)}/24
                </text>
              </>
            )}
          </g>

          {/* pied de planche */}
          <g fontFamily="LkMono" fontSize={15} fill={C.soft} letterSpacing={1}>
            <text x={64} y={1290}>ÉCH. 2:1</text>
            <text x={1016} y={1290} textAnchor="end">PLANCHE 1/1</text>
          </g>
          <Triad cam={cam} />

          {/* carton final */}
          {f >= IMPACT ? (
            <g>
              <text x={540} y={1110} textAnchor="middle" fontFamily="LkTitle" fontSize={64} fill={C.ink} opacity={endIn} transform={`translate(0, ${(1 - endIn) * 18})`} letterSpacing={-1}>
                24 pièces.
              </text>
              <text x={540} y={1182} textAnchor="middle" fontFamily="LkTitle" fontSize={64} fill={C.accent} opacity={endIn2} transform={`translate(0, ${(1 - endIn2) * 18})`} letterSpacing={-1}>
                Une seule clé.
              </text>
            </g>
          ) : null}
        </svg>
      </AbsoluteFill>
    </FontGate>
  );
};
