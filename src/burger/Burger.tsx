import React, {useEffect, useMemo, useState} from 'react';
import {
  AbsoluteFill, Easing, Html5Audio, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {Cam, DrawItem, V3, project, renderPart, rotAround} from './engine';
import {C, LAYERS, LayerDef, TOTAL_GRAMS} from './model';

// ---------- rythme : 120 BPM, un temps = 15 images ----------
const BEAT = 15;
const FIRST = 4 * BEAT; // première couche qui s'envole (temps 4)
const HL0 = 15 * BEAT; // surbrillance des étiquettes, une par temps
const LABEL_OUT = 394;
const COLLAPSE = 405;
const IMPACT = 420; // temps 28 : tout retombe

const FONT_CSS = `
@font-face { font-family: 'BgCond'; src: local('AvenirNextCondensed-DemiBold'), local('Avenir Next Condensed Demi Bold'); }
@font-face { font-family: 'BgTitle'; src: local('AvenirNext-Bold'), local('Avenir Next Bold'); }
@font-face { font-family: 'BgMono'; src: local('Menlo-Regular'), local('Menlo'); }
@font-face { font-family: 'BgMonoB'; src: local('Menlo-Bold'); }
`;
const FAMILIES = ['BgCond', 'BgTitle', 'BgMono', 'BgMonoB'];

const N = LAYERS.length;
const startOf = (i: number) => FIRST + i * BEAT;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (f: number, a: number, b: number, e = Easing.out(Easing.cubic)) =>
  interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e});

const collapseFactor = (f: number) => {
  if (f < COLLAPSE) return 1;
  if (f >= IMPACT) return 0;
  return 1 - Easing.in(Easing.quad)((f - COLLAPSE) / (IMPACT - COLLAPSE));
};

const amountOf = (i: number, f: number, fps: number) => {
  const s = startOf(i);
  if (f < s) return 0;
  const sp = spring({frame: f - s, fps, config: {damping: 13, stiffness: 120, mass: 0.75}});
  return sp * collapseFactor(f);
};

const squashAt = (f: number) => {
  if (f < IMPACT) return 1;
  const k = f - IMPACT;
  return 1 - 0.13 * Math.exp(-k / 3.4) * Math.cos(k * 0.78);
};

/** Décalage vertical courant d'une couche (hors écrasement). */
const liftOf = (L: LayerDef, i: number, amt: number, f: number) => {
  const ph = i * 1.37;
  const bob = Math.sin((f / 60) * Math.PI * 2 + ph) * 1.8 * clamp01(amt) * (L.id === 'bottom' ? 0 : 1);
  // petit sursaut « on ouvre » sur le temps 3
  const hop = f >= 45 && f < 57 ? Math.sin((Math.PI * (f - 45)) / 12) * 9 : 0;
  // le talon saute sur place à son tour
  const s = startOf(i);
  const bHop = L.id === 'bottom' && f >= s && f < s + 12 ? Math.sin((Math.PI * (f - s)) / 12) * 12 : 0;
  // surbrillance : la couche se soulève
  const h0 = HL0 + i * BEAT;
  const hl = f >= h0 && f < h0 + 14 ? Math.sin((Math.PI * (f - h0)) / 14) * 7 : 0;
  return L.z0 + (L.zx - L.z0) * amt + bob + hop + bHop + hl;
};

const makeXf = (L: LayerDef, i: number, amt: number, f: number) => {
  const zOff = liftOf(L, i, amt, f);
  const spin = ((L.spin * Math.PI) / 180) * amt;
  const tilt = ((7 * Math.PI) / 180) * Math.sin(Math.PI * clamp01(amt)) * (i % 2 ? -1 : 1);
  const sq = squashAt(f);
  const e = (1 - sq) * 0.45;
  const c: V3 = [0, 0, L.top / 2];
  return (p: V3): V3 => {
    let q = p;
    if (spin) q = rotAround(q, [0, 0, 0], 'z', spin);
    if (tilt) q = rotAround(q, c, 'x', tilt);
    return [q[0] * (1 + e), q[1] * (1 + e), (q[2] + zOff) * sq];
  };
};

// ---------- caméra ----------
const EL = (31 * Math.PI) / 180;
const azDegAt = (f: number) => interpolate(f, [0, 450], [-38, 50], {easing: Easing.inOut(Easing.sin)});
const S_IN = 3.3;
const S_EX = 2.36;
const CZ_IN = 52;
const CZ_EX = 190;
const camAt = (f: number): Cam => {
  const az = azDegAt(f);
  const t = ease(f, 28, 84, Easing.inOut(Easing.cubic));
  let scale = interpolate(f, [0, 28], [S_IN - 0.06, S_IN], {extrapolateRight: 'clamp'}) * (1 - t) + S_EX * t;
  scale *= interpolate(f, [84, COLLAPSE], [1, 0.985], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  let cz = CZ_IN + (CZ_EX - CZ_IN) * t;
  let cy = 712;
  if (f >= COLLAPSE) {
    const u = Easing.in(Easing.quad)(clamp01((f - COLLAPSE) / (IMPACT - COLLAPSE)));
    scale = S_EX * 0.985 + (S_IN + 0.08 - S_EX * 0.985) * u;
    cz = CZ_EX + (CZ_IN - CZ_EX) * u;
    cy = 712 + (676 - 712) * u;
  }
  if (f >= IMPACT) {
    const k = f - IMPACT;
    scale = S_IN + 0.08 + 0.06 * Math.exp(-k / 4) * Math.cos(k * 0.9);
    cz = CZ_IN;
    cy = 676;
  }
  return {az: (az * Math.PI) / 180, el: EL, scale, cx: 540, cy, cz};
};

const shakeAt = (f: number): [number, number] => {
  if (f < IMPACT) return [0, 0];
  const k = f - IMPACT;
  const a = 10 * Math.exp(-k / 3.5);
  return [a * Math.sin(k * 2.3), a * Math.cos(k * 3.1)];
};

// ancre sur une pièce précise : choisie une fois, pour l'azimut moyen de la vue éclatée
const MID_AZ = (azDegAt(260) * Math.PI) / 180;
const fixedAnchor = LAYERS.map((L) => {
  if (L.anchor.kind !== 'pts') return null;
  const spin = (L.spin * Math.PI) / 180;
  let best = L.anchor.pts[0];
  let bestX = L.side === 'L' ? Infinity : -Infinity;
  for (const p of L.anchor.pts) {
    const q = rotAround(p, [0, 0, 0], 'z', spin);
    const x = q[0] * Math.cos(MID_AZ) - q[1] * Math.sin(MID_AZ);
    if (L.side === 'L' ? x < bestX : x > bestX) {
      bestX = x;
      best = p;
    }
  }
  return best;
});

// ---------- étiquettes ----------
const LEFT_X = 316;
const RIGHT_X = 764;
const GAP = 78;
const layoutSide = (ys: number[]) => {
  const ord = ys.map((y, i) => ({y, i})).sort((a, b) => a.y - b.y);
  const out = new Array(ys.length).fill(0);
  let prev = -Infinity;
  const pos = ord.map((o) => {
    const y = Math.max(o.y, prev + GAP, 250);
    prev = y;
    return y;
  });
  const maxY = 1150;
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
const pathOf = (pts: V3[], close = true) =>
  pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('') + (close ? 'Z' : '');
const circ = (r: number, z: number, n = 72): V3[] =>
  Array.from({length: n}, (_, i) => [r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2), z] as V3);

export const Burger: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const f = frame;

  const scene = useMemo(() => {
    const cam = camAt(f);
    const [shx, shy] = shakeAt(f);
    cam.cx += shx;
    cam.cy += shy;
    const amts = LAYERS.map((_, i) => amountOf(i, f, fps));
    const xfs = LAYERS.map((L, i) => makeXf(L, i, amts[i], f));
    const items: DrawItem[] = [];
    const sq = squashAt(f);
    // du dessous vers le dessus ; trait d'axe entre deux couches
    for (let i = N - 1; i >= 0; i--) {
      const L = LAYERS[i];
      renderPart({geo: L.geo, topo: L.topo, xf: (p) => xfs[i](p)}, cam, items);
      const top = xfs[i]([0, 0, L.top + 0.3]);
      const nextBase = i > 0 ? xfs[i - 1]([0, 0, -0.3]) : ([0, 0, top[2] + 34 * clamp01(amts[0])] as V3);
      if (nextBase[2] - top[2] > 5) {
        const a = project(top, cam);
        const b = project(nextBase, cam);
        items.push({fill: 'none', d: '', edges: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`, ew: 1.3, ec: C.soft, dash: '14 5 3 5'});
      }
    }
    // plateau tournant (sol), ombre
    const ground = {
      shadow: pathOf(circ(60 * (1 + (1 - sq) * 0.6), 0, 64).map((p) => project(p, cam))),
      ringOut: pathOf(circ(80, 0, 96).map((p) => project(p, cam))),
      ringIn: pathOf(circ(74, 0, 96).map((p) => project(p, cam))),
      ticks: Array.from({length: 72}, (_, k) => {
        const a = (k / 72) * Math.PI * 2;
        const r1 = k % 6 === 0 ? 68 : 74;
        const p = project([80 * Math.cos(a), 80 * Math.sin(a), 0], cam);
        const q = project([r1 * Math.cos(a), r1 * Math.sin(a), 0], cam);
        return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
      }).join(''),
      index: (() => {
        // repère fixe face caméra
        const ca = Math.cos(cam.az);
        const sa = Math.sin(cam.az);
        const toW = (xr: number, yr: number): V3 => [xr * ca + yr * sa, -xr * sa + yr * ca, 0];
        return pathOf([toW(0, -84), toW(-4.5, -92), toW(4.5, -92)].map((p) => project(p, cam)));
      })(),
    };

    // étiquettes
    const anchorAt = (i: number, amtOverride?: number): V3 => {
      const L = LAYERS[i];
      const amt = amtOverride ?? amts[i];
      if (L.anchor.kind === 'rim') {
        const ca = Math.cos(cam.az);
        const sa = Math.sin(cam.az);
        const ang = L.side === 'L' ? (196 * Math.PI) / 180 : (-16 * Math.PI) / 180;
        const xr = Math.cos(ang);
        const yr = Math.sin(ang);
        const dx = xr * ca + yr * sa;
        const dy = -xr * sa + yr * ca;
        const z = liftOf(L, i, amt, f) + L.anchor.z;
        return project([dx * L.anchor.r, dy * L.anchor.r, z * sq], cam);
      }
      const xf = amtOverride === undefined ? xfs[i] : makeXf(L, i, amtOverride, f);
      return project(xf(fixedAnchor[i]!), cam);
    };
    const lab = LAYERS.map((L, i) => ({L, i, cur: anchorAt(i), fin: anchorAt(i, f < COLLAPSE ? 1 : amts[i])}));
    const ys = new Map<number, number>();
    for (const side of ['L', 'R'] as const) {
      const sel = lab.filter((l) => l.L.side === side);
      const pos = layoutSide(sel.map((l) => l.fin[1]));
      sel.forEach((l, k) => ys.set(l.i, pos[k]));
    }
    // centre écran du burger (pour l'éclat d'impact)
    const mid = project([0, 0, 50 * sq], cam);
    return {cam, items, lab, ys, ground, mid};
  }, [f, fps]);

  const {cam, items, lab, ys, ground, mid} = scene;

  // compteurs d'en-tête
  const count = LAYERS.filter((_, i) => f >= startOf(i) + 11).length;
  const mass = Math.round(LAYERS.reduce((s, L, i) => s + L.grams * ease(f, startOf(i) + 8, startOf(i) + 18, Easing.inOut(Easing.quad)), 0));
  const massPulse = f >= HL0 + N * BEAT && f < HL0 + N * BEAT + 14 ? Math.sin((Math.PI * (f - HL0 - N * BEAT)) / 14) : 0;
  const azDeg = (cam.az * 180) / Math.PI;

  const titleIn = 1;
  const dimIn = ease(f, 6, 22) * (1 - ease(f, 34, 46, Easing.in(Easing.cubic)));
  const endIn = ease(f, IMPACT + 3, IMPACT + 14);
  const endIn2 = ease(f, IMPACT + 9, IMPACT + 20);
  const burstT = f >= IMPACT ? (f - IMPACT) / 11 : -1;
  const hi = f >= HL0 && f < HL0 + N * BEAT ? Math.floor((f - HL0) / BEAT) : -1;

  // cotes d'introduction (burger monté)
  const dimSc = S_IN;
  const halfW = 55.5 * dimSc;
  const dimY = cam.cy + (CZ_IN - 0) * dimSc * Math.cos(EL) + 80 * dimSc * Math.sin(EL) + 34;

  return (
    <FontGate>
      <AbsoluteFill style={{background: C.paper}}>
        <Html5Audio src={staticFile('burger/burger.wav')} />
        <svg width={1080} height={1350} viewBox="0 0 1080 1350" style={{position: 'absolute', inset: 0}}>
          <Grid />
          <rect x={28} y={28} width={1024} height={1294} fill="none" stroke={C.ink} strokeWidth={1.6} />
          {[[28, 28], [1052, 28], [28, 1322], [1052, 1322]].map(([x, y], i) => (
            <g key={i} stroke={C.ink} strokeWidth={1.6}>
              <line x1={x - 12} y1={y} x2={x + 12} y2={y} />
              <line x1={x} y1={y - 12} x2={x} y2={y + 12} />
            </g>
          ))}

          {/* plateau tournant */}
          <g>
            <path d={ground.ringOut} fill={C.paper} stroke={C.ink} strokeWidth={1.4} />
            <path d={ground.ringIn} fill="none" stroke={C.soft} strokeWidth={1} />
            <path d={ground.ticks} fill="none" stroke={C.soft} strokeWidth={1.2} />
            <path d={ground.shadow} fill={C.shadow} />
            <path d={ground.index} fill={C.accent} stroke={C.ink} strokeWidth={1} strokeLinejoin="round" />
          </g>

          {/* le burger */}
          <g strokeLinejoin="round" strokeLinecap="round">
            {items.map((it, i) => (
              <g key={i}>
                {it.d ? <path d={it.d} fill={it.fill} stroke={it.fill} strokeWidth={0.9} /> : null}
                {it.edges ? (
                  <path d={it.edges} fill="none" stroke={it.ec ?? C.ink} strokeWidth={it.ew ?? 1.7} strokeDasharray={it.dash} />
                ) : null}
              </g>
            ))}
          </g>

          {/* cotes d'introduction */}
          {dimIn > 0.001 ? (
            <g opacity={dimIn} stroke={C.ink} strokeWidth={1.3} fontFamily="BgMono" fontSize={18}>
              <line x1={540 - halfW} y1={dimY - 16} x2={540 - halfW} y2={dimY + 10} />
              <line x1={540 + halfW} y1={dimY - 16} x2={540 + halfW} y2={dimY + 10} />
              <line x1={540 - halfW} y1={dimY} x2={540 + halfW} y2={dimY} />
              <path d={`M${540 - halfW} ${dimY}l12 -5v10z M${540 + halfW} ${dimY}l-12 -5v10z`} fill={C.ink} />
              <text x={540} y={dimY + 34} textAnchor="middle" stroke="none" fill={C.ink}>Ø 110 mm</text>
            </g>
          ) : null}

          {/* éclat d'impact */}
          {burstT >= 0 && burstT <= 1 ? (
            <g stroke={C.ink} strokeWidth={2.2} strokeLinecap="round">
              {Array.from({length: 14}, (_, i) => {
                const a = (i / 14) * Math.PI * 2 + 0.15;
                const r0 = 300 + burstT * 80;
                const r1 = r0 + 38 * (1 - burstT);
                return (
                  <line key={i} x1={mid[0] + Math.cos(a) * r0} y1={mid[1] + Math.sin(a) * r0 * 0.8} x2={mid[0] + Math.cos(a) * r1} y2={mid[1] + Math.sin(a) * r1 * 0.8} opacity={1 - burstT} />
                );
              })}
            </g>
          ) : null}

          {/* étiquettes et traits de rappel */}
          {lab.map(({L, i, cur}) => {
            const t = f - startOf(i);
            const lineP = ease(t, 6, 15);
            const txtP = ease(t, 10, 19);
            const out = 1 - ease(f, LABEL_OUT, LABEL_OUT + 11, Easing.in(Easing.cubic));
            const lp = lineP * out;
            const tp = txtP * out;
            if (lp <= 0.001) return null;
            const y = ys.get(i)!;
            const left = L.side === 'L';
            const bx = left ? LEFT_X : RIGHT_X;
            const ax = cur[0];
            const ay = cur[1];
            const sx = left ? bx + 17 : bx - 17;
            const ex = ax + (sx - ax) * lp;
            const ey = ay + (y - ay) * lp;
            const isHi = i === hi;
            const hiK = isHi ? 1 - ((f - HL0) % BEAT) / BEAT : 0;
            const shift = (1 - tp) * 24 * (left ? 1 : -1);
            const tx = left ? bx - 28 : bx + 28;
            const anchor = left ? 'end' : 'start';
            return (
              <g key={L.n}>
                <line x1={ax} y1={ay} x2={ex} y2={ey} stroke={C.ink} strokeWidth={1.5} />
                <circle cx={ax} cy={ay} r={5} fill={C.ink} stroke={C.paper} strokeWidth={1.8} />
                <g opacity={tp} transform={`translate(${shift},0)`}>
                  <circle cx={bx} cy={y} r={17 + hiK * 3} fill={isHi ? C.accent : C.paper} stroke={isHi ? C.accent : C.ink} strokeWidth={1.6} />
                  <text x={bx} y={y + 5.2} textAnchor="middle" fontFamily="BgMonoB" fontSize={15} fill={isHi ? C.paper : C.ink}>
                    {L.n}
                  </text>
                  <text x={tx} y={y - 4} textAnchor={anchor} fontFamily="BgCond" fontSize={34} fill={C.ink} stroke={C.paper} strokeWidth={6} paintOrder="stroke">
                    {L.name}
                  </text>
                  <text x={tx} y={y + 24} textAnchor={anchor} fontFamily="BgMono" fontSize={17} fill={C.soft} stroke={C.paper} strokeWidth={5} paintOrder="stroke">
                    <tspan fontFamily="BgMonoB" fill={isHi ? C.accent : C.ink}>{L.grams} g</tspan>
                    {' · ' + L.detail}
                  </text>
                </g>
              </g>
            );
          })}

          {/* en-tête */}
          <g opacity={titleIn} transform={`translate(0, ${(1 - titleIn) * -14})`}>
            <text x={64} y={92} fontFamily="BgMonoB" fontSize={17} fill={C.accent} letterSpacing={2}>
              FIG. 05 — VUE ÉCLATÉE
            </text>
            <text x={62} y={150} fontFamily="BgTitle" fontSize={56} fill={C.ink} letterSpacing={-1}>
              Le burger parfait
            </text>
            <text x={1016} y={92} textAnchor="end" fontFamily="BgMonoB" fontSize={17} fill={C.ink} letterSpacing={2}>
              COUCHES {String(count).padStart(2, '0')}/{String(N).padStart(2, '0')}
            </text>
            <text
              x={1016}
              y={120}
              textAnchor="end"
              fontFamily="BgMonoB"
              fontSize={17 + massPulse * 4}
              fill={massPulse > 0.05 ? C.accent : C.ink}
              letterSpacing={2}
            >
              MASSE {String(mass).padStart(3, '0')} g
            </text>
            <text x={1016} y={146} textAnchor="end" fontFamily="BgMono" fontSize={15} fill={C.soft} letterSpacing={1}>
              AZIMUT {fmtDeg(azDeg)}
            </text>
          </g>

          {/* pied de planche */}
          <g fontFamily="BgMono" fontSize={15} fill={C.soft} letterSpacing={1}>
            <text x={64} y={1290}>RECETTE MAISON · {TOTAL_GRAMS} g</text>
            <text x={1016} y={1290} textAnchor="end">PLANCHE 1/1</text>
          </g>
          <Triad cam={cam} />

          {/* carton final */}
          {f >= IMPACT ? (
            <g>
              <text x={540} y={1122} textAnchor="middle" fontFamily="BgTitle" fontSize={64} fill={C.ink} opacity={endIn} transform={`translate(0, ${(1 - endIn) * 18})`} letterSpacing={-1}>
                9 couches.
              </text>
              <text x={540} y={1194} textAnchor="middle" fontFamily="BgTitle" fontSize={64} fill={C.accent} opacity={endIn2} transform={`translate(0, ${(1 - endIn2) * 18})`} letterSpacing={-1}>
                Une seule bouchée.
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
        <text x={o[0] + p[0] * 1.35} y={o[1] + p[1] * 1.35 + 5} textAnchor="middle" fontFamily="BgMono" fontSize={13} fill={C.soft}>
          {label}
        </text>
      </g>
    );
  };
  return <g>{[arm([34, 0, 0], 'x'), arm([0, 34, 0], 'y'), arm([0, 0, 34], 'z')]}<circle cx={o[0]} cy={o[1]} r={3} fill={C.ink} /></g>;
};
