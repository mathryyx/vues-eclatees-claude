import React, {useEffect, useMemo, useState} from 'react';
import {
  AbsoluteFill, Easing, Html5Audio, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {Cam, DrawItem, PartInstance, V3, project, renderPart, rotAround} from './engine';
import {C, MOTOR_WEIGHT_PIECE, PARTS, PartDef} from './model';

// ---------- rythme : 120 BPM, un temps = 15 images ----------
const BEAT = 15;
const COLLAPSE = 408; // début du remontage
const IMPACT = 420; // tout est remonté (temps 28)

const FONT_CSS = `
@font-face { font-family: 'AnaCond'; src: local('AvenirNextCondensed-DemiBold'), local('Avenir Next Condensed Demi Bold'); }
@font-face { font-family: 'AnaCondReg'; src: local('AvenirNextCondensed-Medium'), local('Avenir Next Condensed Medium'); }
@font-face { font-family: 'AnaTitle'; src: local('AvenirNext-Bold'), local('Avenir Next Bold'); }
@font-face { font-family: 'AnaMono'; src: local('Menlo-Regular'), local('Menlo'); }
@font-face { font-family: 'AnaMonoB'; src: local('Menlo-Bold'); }
`;
const FAMILIES = ['AnaCond', 'AnaCondReg', 'AnaTitle', 'AnaMono', 'AnaMonoB'];

interface Slot {
  part: PartDef;
  start: number;
}

const P = PARTS;
const SLOTS: Slot[] = [
  ...P.screws.map((part, i) => ({part, start: 4 * BEAT + i * 3})),
  {part: P.stickCaps, start: 5 * BEAT},
  {part: P.dpad, start: 6 * BEAT},
  {part: P.buttons, start: 7 * BEAT},
  {part: P.topShell, start: 8 * BEAT},
  {part: P.triggerL, start: 9 * BEAT},
  {part: P.triggerR, start: 9 * BEAT + 2},
  {part: P.membrane, start: 10 * BEAT},
  {part: P.modules, start: 11 * BEAT},
  {part: P.bottomShell, start: 12 * BEAT},
  {part: P.battery, start: 13 * BEAT},
  {part: P.motorL, start: 14 * BEAT},
  {part: P.motorR, start: 14 * BEAT + 3},
  {part: P.pcb, start: 15 * BEAT},
];
const startOf = (id: string) => SLOTS.find((s) => s.part.id === id)!.start;

// ordre de dessin (du dessous vers le dessus)
const DRAW_ORDER: PartDef[] = [
  ...P.screws, P.bottomShell, P.battery, P.motorL, P.motorR, P.pcb, P.modules, P.membrane, P.triggerL, P.triggerR, P.topShell,
  P.dpad, P.buttons, P.stickCaps,
];

interface LabelDef {
  n: string;
  name: string;
  spec: string;
  part: PartDef;
  side: 'L' | 'R';
  anchor: V3;
}
const LABELS: LabelDef[] = [
  {n: '01', name: 'Vis de fixation', spec: 'M2 × 8 · ×4', part: P.screws[0], side: 'L', anchor: [-216, -168, -8]},
  {n: '02', name: 'Capuchons de sticks', spec: 'caoutchouc · ×2', part: P.stickCaps, side: 'R', anchor: [134, -52, 64]},
  {n: '03', name: 'Croix directionnelle', spec: '4 directions', part: P.dpad, side: 'L', anchor: [-244, 32, 56]},
  {n: '04', name: "Boutons d'action", spec: '×4', part: P.buttons, side: 'R', anchor: [251, 32, 56]},
  {n: '05', name: 'Coque supérieure', spec: 'ABS', part: P.topShell, side: 'L', anchor: [-289, 0, 26]},
  {n: '06', name: 'Gâchettes', spec: 'analogiques · L / R', part: P.triggerL, side: 'L', anchor: [-224, 205, 34]},
  {n: '07', name: 'Membranes', spec: 'silicone conducteur', part: P.membrane, side: 'L', anchor: [-248, 32, 40]},
  {n: '08', name: 'Modules analogiques', spec: '2 axes · ×2', part: P.modules, side: 'R', anchor: [126, -52, 32]},
  {n: '09', name: 'Coque inférieure', spec: 'ABS', part: P.bottomShell, side: 'L', anchor: [-292, -20, -14]},
  {n: '10', name: 'Batterie', spec: 'Li-ion 3,7 V', part: P.battery, side: 'R', anchor: [100, 6, 14]},
  {n: '11', name: 'Moteurs de vibration', spec: 'masse excentrique · ×2', part: P.motorL, side: 'L', anchor: [-232, -128, 16]},
  {n: '12', name: 'Circuit imprimé', spec: 'carte principale', part: P.pcb, side: 'R', anchor: [244, 20, 24]},
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const collapseFactor = (f: number) => {
  if (f < COLLAPSE) return 1;
  if (f >= IMPACT) return 0;
  return 1 - Easing.in(Easing.cubic)((f - COLLAPSE) / (IMPACT - COLLAPSE));
};

const amountOf = (part: PartDef, f: number, fps: number) => {
  const s = SLOTS.find((x) => x.part === part)!;
  if (f < s.start) return 0;
  const sp = spring({frame: f - s.start, fps, config: {damping: 16, stiffness: 170, mass: 0.7}});
  return sp * collapseFactor(f);
};

const makeXf = (part: PartDef, amt: number, f: number) => {
  const e = part.explode;
  const ph = (part.center[0] * 0.013 + part.center[2] * 0.021) % (Math.PI * 2);
  const bob = Math.sin((f / 60) * Math.PI * 2 + ph) * 3.5 * clamp01(amt);
  const wob = part.wobble ? ((part.wobble.deg * Math.PI) / 180) * Math.sin(Math.PI * clamp01(amt)) : 0;
  // petit sursaut « déverrouillage » sur le temps 3
  const hop = f >= 45 && f < 57 ? Math.sin((Math.PI * (f - 45)) / 12) * 12 : 0;
  const isMotor = part.id === 'motorL' || part.id === 'motorR';
  const spin = isMotor ? clamp01((f - startOf(part.id) - 8) / 10) * (f - startOf(part.id)) * 0.55 : 0;
  return (p: V3, piece: number): V3 => {
    let q = p;
    if (isMotor && piece === MOTOR_WEIGHT_PIECE && spin) q = rotAround(q, [part.center[0], 0, 16], 'y', spin);
    if (wob && part.wobble) q = rotAround(q, part.center, part.wobble.axis, wob);
    return [q[0] + e[0] * amt, q[1] + e[1] * amt, q[2] + e[2] * amt + bob + hop];
  };
};

// ---------- caméra ----------
const camAt = (f: number, fps: number): Cam => {
  const az = interpolate(f, [0, 450], [-30, 24], {easing: Easing.inOut(Easing.sin)});
  let scale = interpolate(f, [0, 55, 110, 200, COLLAPSE], [1.12, 1.08, 0.9, 0.84, 0.82], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateRight: 'clamp',
  });
  let cz = interpolate(f, [60, 235], [0, 22], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  if (f >= COLLAPSE) {
    const t = Easing.in(Easing.cubic)(clamp01((f - COLLAPSE) / (IMPACT - COLLAPSE)));
    scale = 0.82 + (1.1 - 0.82) * t;
    cz = 22 * (1 - t);
  }
  if (f >= IMPACT) {
    const k = f - IMPACT;
    scale = 1.1 + 0.05 * Math.exp(-k / 4) * Math.cos(k * 0.9);
  }
  return {az: (az * Math.PI) / 180, el: (32 * Math.PI) / 180, scale, cx: 540, cy: 690, cz};
};

const shakeAt = (f: number): [number, number] => {
  if (f < IMPACT) return [0, 0];
  const k = f - IMPACT;
  const a = 9 * Math.exp(-k / 3.5);
  return [a * Math.sin(k * 2.3), a * Math.cos(k * 3.1)];
};

// ---------- étiquettes ----------
const LEFT_X = 290;
const RIGHT_X = 790;
const GAP = 70;
const layoutSide = (ys: number[]) => {
  const ord = ys.map((y, i) => ({y, i})).sort((a, b) => a.y - b.y);
  const out = new Array(ys.length).fill(0);
  let prev = -Infinity;
  const pos = ord.map((o) => {
    const y = Math.max(o.y, prev + GAP);
    prev = y;
    return y;
  });
  const maxY = 1170;
  for (let k = pos.length - 1; k >= 0; k--) {
    const lim = k === pos.length - 1 ? maxY : pos[k + 1] - GAP;
    if (pos[k] > lim) pos[k] = lim;
  }
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

export const Anatomy: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const f = frame;

  const scene = useMemo(() => {
    const cam = camAt(f, fps);
    const [shx, shy] = shakeAt(f);
    cam.cx += shx;
    cam.cy += shy;
    const amts = new Map<PartDef, number>();
    for (const s of SLOTS) amts.set(s.part, amountOf(s.part, f, fps));
    const items: DrawItem[] = [];
    // les gâchettes passent devant la coque une fois au-dessus d'elle
    const shellTop = 44 + 320 * amts.get(P.topShell)!;
    const order = [...DRAW_ORDER];
    for (const tg of [P.triggerL, P.triggerR]) {
      if (3 + 470 * amts.get(tg)! > shellTop + 4) {
        order.splice(order.indexOf(tg), 1);
        order.splice(order.indexOf(P.topShell) + 1, 0, tg);
      }
    }
    for (const part of order) {
      const amt = amts.get(part)!;
      const inst: PartInstance = {geo: part.geo, topo: part.topo, xf: makeXf(part, amt, f)};
      renderPart(inst, cam, items);
    }
    // traits d'axe (mixtes) : sticks, croix, boutons, vis
    const axes: {a: [number, number]; b: [number, number]; dashed?: boolean}[] = [];
    const zOf = (part: PartDef, z: number) => z + part.explode[2] * amts.get(part)!;
    const axis = (x: number, y: number, zs: number[], dashed?: boolean) => {
      const lo = Math.min(...zs);
      const hi = Math.max(...zs);
      if (hi - lo < 12) return;
      const a = project([x, y, lo], cam);
      const b = project([x, y, hi], cam);
      axes.push({a: [a[0], a[1]], b: [b[0], b[1]], dashed});
    };
    for (const [x, y] of [[-100, -52], [100, -52]]) axis(x, y, [zOf(P.modules, 30), zOf(P.topShell, 44), zOf(P.stickCaps, 70)]);
    axis(-188, 32, [zOf(P.membrane, 40), zOf(P.topShell, 44), zOf(P.dpad, 56)]);
    axis(188, 32, [zOf(P.membrane, 40), zOf(P.topShell, 44), zOf(P.buttons, 56)]);
    P.screws.forEach((s, i) => {
      const c = s.center;
      void i;
      axis(c[0], c[1], [zOf(s, -8), zOf(P.bottomShell, -40)], true);
    });

    // étiquettes : positions d'ancrage actuelles + positions « finales » pour la mise en page
    const lab = LABELS.map((L) => {
      const amt = amts.get(L.part)!;
      const cur = project(makeXf(L.part, amt, f)(L.anchor, 0), cam);
      const fin = project(makeXf(L.part, 1, f)(L.anchor, 0), cam);
      return {L, cur, fin};
    });
    const ys = new Map<LabelDef, number>();
    for (const side of ['L', 'R'] as const) {
      const sel = lab.filter((l) => l.L.side === side);
      const pos = layoutSide(sel.map((l) => l.fin[1]));
      sel.forEach((l, i) => ys.set(l.L, pos[i]));
    }
    return {cam, items, axes, lab, ys, amts};
  }, [f, fps]);

  const {cam, items, axes, lab, ys, amts} = scene;

  // nombre de pièces sorties
  const count = LABELS.filter((L) => f >= startOf(L.part.id)).length;
  const azDeg = (cam.az * 180) / Math.PI;

  // titre et carton final
  const titleIn = interpolate(f, [-1, 0], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const endIn = interpolate(f, [IMPACT + 3, IMPACT + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const endIn2 = interpolate(f, [IMPACT + 9, IMPACT + 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});

  // éclat d'impact
  const burstT = f >= IMPACT ? (f - IMPACT) / 10 : -1;

  // surbrillance : une étiquette par croche, de 01 à 12 (images 240 → 330)
  const hi = f >= 240 && f < 330 ? Math.floor((f - 240) / 7.5) : -1;

  return (
    <FontGate>
      <AbsoluteFill style={{background: C.paper}}>
        <Html5Audio src={staticFile('anatomy/anatomy.wav')} />
        <svg width={1080} height={1350} viewBox="0 0 1080 1350" style={{position: 'absolute', inset: 0}}>
          <Grid />
          {/* cadre de planche */}
          <rect x={28} y={28} width={1024} height={1294} fill="none" stroke={C.ink} strokeWidth={1.6} />
          {[[28, 28], [1052, 28], [28, 1322], [1052, 1322]].map(([x, y], i) => (
            <g key={i} stroke={C.ink} strokeWidth={1.6}>
              <line x1={x - 12} y1={y} x2={x + 12} y2={y} />
              <line x1={x} y1={y - 12} x2={x} y2={y + 12} />
            </g>
          ))}

          {/* axes mixtes */}
          <g stroke={C.soft} strokeWidth={1.3} fill="none">
            {axes.map((a, i) => (
              <line key={i} x1={a.a[0]} y1={a.a[1]} x2={a.b[0]} y2={a.b[1]} strokeDasharray={a.dashed ? '6 5' : '16 5 3 5'} />
            ))}
          </g>

          {/* la manette */}
          <g strokeLinejoin="round" strokeLinecap="round">
            {items.map((it, i) => (
              <g key={i}>
                <path d={it.d} fill={it.fill} stroke={it.fill} strokeWidth={0.9} />
                {it.edges ? <path d={it.edges} fill="none" stroke={C.ink} strokeWidth={1.7} /> : null}
              </g>
            ))}
          </g>

          {/* éclat d'impact */}
          {burstT >= 0 && burstT <= 1 ? (
            <g stroke={C.ink} strokeWidth={2.2} strokeLinecap="round">
              {Array.from({length: 12}, (_, i) => {
                const a = (i / 12) * Math.PI * 2 + 0.2;
                const r0 = 330 + burstT * 90;
                const r1 = r0 + 40 * (1 - burstT);
                const cx = 540;
                const cy = 640;
                return (
                  <line key={i} x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0 * 0.62} x2={cx + Math.cos(a) * r1} y2={cy + Math.sin(a) * r1 * 0.62} opacity={1 - burstT} />
                );
              })}
            </g>
          ) : null}

          {/* étiquettes et traits de rappel */}
          {lab.map(({L, cur}, li) => {
            const st = startOf(L.part.id);
            const t = f - st;
            const lineP = interpolate(t, [6, 15], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
            const txtP = interpolate(t, [11, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
            const out = interpolate(f, [394, 405], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});
            const lp = lineP * out;
            const tp = txtP * out;
            if (lp <= 0.001) return null;
            const y = ys.get(L)!;
            const left = L.side === 'L';
            const bx = left ? LEFT_X + 14 : RIGHT_X - 14; // pastille
            const ax = cur[0];
            const ay = cur[1];
            const sx = left ? bx + 15 : bx - 15;
            const ex = ax + (sx - ax) * lp;
            const ey = ay + (y - ay) * lp;
            const isHi = li === hi;
            const hiK = isHi ? 1 - ((f - 240) % 7.5) / 7.5 : 0;
            const shift = (1 - tp) * 24 * (left ? 1 : -1);
            return (
              <g key={L.n}>
                <line x1={ax} y1={ay} x2={ex} y2={ey} stroke={C.ink} strokeWidth={1.4} />
                <circle cx={ax} cy={ay} r={4.6} fill={C.ink} stroke={C.paper} strokeWidth={1.6} />
                <g opacity={tp} transform={`translate(${shift},0)`}>
                  <circle cx={bx} cy={y} r={15 + hiK * 3} fill={isHi ? C.accent : C.paper} stroke={isHi ? C.accent : C.ink} strokeWidth={1.5} />
                  <text x={bx} y={y + 4.6} textAnchor="middle" fontFamily="AnaMonoB" fontSize={13} fill={isHi ? C.paper : C.ink}>
                    {L.n}
                  </text>
                  <text
                    x={left ? bx - 24 : bx + 24}
                    y={y - 3}
                    textAnchor={left ? 'end' : 'start'}
                    fontFamily="AnaCond"
                    fontSize={26}
                    fill={C.ink}
                    stroke={C.paper}
                    strokeWidth={5}
                    paintOrder="stroke"
                  >
                    {L.name}
                  </text>
                  <text
                    x={left ? bx - 24 : bx + 24}
                    y={y + 21}
                    textAnchor={left ? 'end' : 'start'}
                    fontFamily="AnaMono"
                    fontSize={15}
                    fill={C.soft}
                    stroke={C.paper}
                    strokeWidth={4}
                    paintOrder="stroke"
                  >
                    {L.spec}
                  </text>
                </g>
              </g>
            );
          })}

          {/* en-tête */}
          <g opacity={titleIn} transform={`translate(0, ${(1 - titleIn) * -14})`}>
            <text x={64} y={92} fontFamily="AnaMonoB" fontSize={17} fill={C.accent} letterSpacing={2}>
              FIG. 01 — VUE ÉCLATÉE
            </text>
            <text x={62} y={150} fontFamily="AnaTitle" fontSize={54} fill={C.ink} letterSpacing={-1}>
              Anatomie d'une manette
            </text>
            <text x={1016} y={92} textAnchor="end" fontFamily="AnaMonoB" fontSize={17} fill={C.ink} letterSpacing={2}>
              PIÈCES {String(count).padStart(2, '0')}/12
            </text>
            <text x={1016} y={118} textAnchor="end" fontFamily="AnaMono" fontSize={15} fill={C.soft} letterSpacing={1}>
              AZIMUT {fmtDeg(azDeg)}
            </text>
          </g>

          {/* pied de planche */}
          <g fontFamily="AnaMono" fontSize={15} fill={C.soft} letterSpacing={1}>
            <text x={64} y={1290}>ÉCH. 1:2</text>
            <text x={1016} y={1290} textAnchor="end">PLANCHE 1/1</text>
          </g>
          <Triad cam={cam} />

          {/* carton final */}
          {f >= IMPACT ? (
            <g>
              <text x={540} y={1100} textAnchor="middle" fontFamily="AnaTitle" fontSize={64} fill={C.ink} opacity={endIn} transform={`translate(0, ${(1 - endIn) * 18})`} letterSpacing={-1}>
                12 pièces.
              </text>
              <text x={540} y={1172} textAnchor="middle" fontFamily="AnaTitle" fontSize={64} fill={C.accent} opacity={endIn2} transform={`translate(0, ${(1 - endIn2) * 18})`} letterSpacing={-1}>
                Un seul clic.
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
        <text x={o[0] + p[0] * 1.35} y={o[1] + p[1] * 1.35 + 5} textAnchor="middle" fontFamily="AnaMono" fontSize={13} fill={C.soft}>
          {label}
        </text>
      </g>
    );
  };
  return <g>{[arm([34, 0, 0], 'x'), arm([0, 34, 0], 'y'), arm([0, 0, 34], 'z')]}<circle cx={o[0]} cy={o[1]} r={3} fill={C.ink} /></g>;
};
