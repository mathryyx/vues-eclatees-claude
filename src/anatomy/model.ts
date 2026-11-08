// Manette générique, modélisée à la main. Unités ≈ pixels à l'échelle 1.
// Repère : x à droite, y vers l'arrière (gâchettes), z vers le haut.
import {
  V2, V3, Geo, Topo, newGeo, loft, decal, ring, circle, catmullClosed, ccw, inset, roundRect, plus, buildTopo,
} from './engine';

export const C = {
  paper: '#F2EEE5',
  grid: '#E3DDD0',
  ink: '#1C2030',
  soft: '#8B8F9E',
  accent: '#F07A3A',
  shellTop: '#5A72DF',
  shellBot: '#4558C0',
  hole: '#252C55',
  button: '#F8F2E4',
  charcoal: '#343A50',
  trigger: '#F07A3A',
  pcb: '#2F9672',
  pad: '#EBBB4B',
  chip: '#272B37',
  battery: '#F4C744',
  band: '#2D3142',
  motor: '#C3C8D2',
  brass: '#DCA341',
  membrane: '#A3D7CE',
  module: '#4B5166',
  dome: '#DADDE4',
  screw: '#C6CBD4',
  light: '#E4EAFF',
};

// ---------- silhouette de la coque ----------
const half: V2[] = [
  [0, 152], [118, 160], [212, 150], [266, 112], [290, 44], [293, -38], [280, -118], [258, -178],
  [220, -210], [180, -204], [150, -166], [118, -136], [68, -123],
];
const ctrl: V2[] = [...half, [0, -124], ...half.slice(1).reverse().map(([x, y]) => [-x, y] as V2)];
export const OUTLINE = ccw(catmullClosed(ctrl, 6));

export const STICKS: V2[] = [[-100, -52], [100, -52]];
export const DPAD: V2 = [-188, 32];
export const BTN: V2 = [188, 32];
export const BTN_OFF: V2[] = [[44, 0], [0, 44], [-44, 0], [0, -44]];
export const SCREWS: V2[] = [[-216, -168], [216, -168], [-62, -96], [62, -96]];
export const MOTORS = [-218, 218];

const SHELL_TOP_Z = 44;

export interface PartDef {
  id: string;
  geo: Geo;
  topo: Topo;
  explode: V3; // déplacement en vue éclatée
  wobble?: {axis: 'x' | 'y' | 'z'; deg: number};
  center: V3;
}

const mk = (id: string, build: (g: Geo) => void, explode: V3, center: V3, wobble?: PartDef['wobble']): PartDef => {
  const g = newGeo();
  build(g);
  return {id, geo: g, topo: buildTopo(g), explode, center, wobble};
};

const cyl = (g: Geo, cx: number, cy: number, profile: [number, number][], color: string, top?: string, n = 32, layer = 0) =>
  loft(g, profile.map(([r, z]) => ring(circle(cx, cy, r, n), z)), {color, topColor: top, layer});

// ---------- pièces ----------
const topShell = mk('topShell', (g) => {
  const p = loft(g, [ring(OUTLINE, 0), ring(OUTLINE, 28), ring(inset(OUTLINE, 8), 38), ring(inset(OUTLINE, 20), SHELL_TOP_Z)], {
    color: C.shellTop,
  });
  const z = SHELL_TOP_Z + 0.2;
  for (const [x, y] of STICKS) decal(g, circle(x, y, 38, 40), z, C.hole, p);
  decal(g, plus(DPAD[0], DPAD[1], 42, 62), z, C.hole, p);
  for (const [dx, dy] of BTN_OFF) decal(g, circle(BTN[0] + dx, BTN[1] + dy, 23, 28), z, C.hole, p);
  decal(g, circle(0, 50, 15, 28), z, C.light, p);
  decal(g, circle(0, 50, 8, 20), z, C.shellTop, p, 0, 1001);
  decal(g, roundRect(-58, 92, 30, 11, 5.5, 4), z, C.light, p);
  decal(g, roundRect(58, 92, 30, 11, 5.5, 4), z, C.light, p);
}, [0, 0, 320], [0, 0, 22], {axis: 'x', deg: 7});

const bottomShell = mk('bottomShell', (g) => {
  const p = loft(g, [ring(inset(OUTLINE, 22), -40), ring(inset(OUTLINE, 8), -36), ring(OUTLINE, -24), ring(OUTLINE, 0)], {
    color: C.shellBot,
  });
  decal(g, inset(OUTLINE, 10), 0.2, '#3446A0', p);
  // bossages de vis
  for (const [x, y] of SCREWS) decal(g, circle(x, y, 12, 20), 0.4, C.shellBot, p, 0, 1001);
}, [0, 0, -310], [0, 0, -20], {axis: 'x', deg: -6});

const screw = (i: number) => mk(`screw${i}`, (g) => {
  const [x, y] = SCREWS[i];
  const prof: [number, number][] = [[8, -40], [9.5, -37.5], [9.5, -35], [4, -35]];
  for (let k = 0; k < 7; k++) {
    const z = -33 + k * 3.8;
    prof.push([4.6, z], [3.6, z + 1.9]);
  }
  prof.push([3.6, -8], [2.4, -6]);
  cyl(g, x, y, prof, C.screw, undefined, 20);
}, [0, 0, -460], [SCREWS[i][0], SCREWS[i][1], -22], {axis: 'z', deg: 0});

const stickCaps = mk('caps', (g) => {
  for (const [x, y] of STICKS) {
    const p = cyl(g, x, y, [[11, SHELL_TOP_Z], [11, SHELL_TOP_Z + 14], [33, SHELL_TOP_Z + 14], [35, SHELL_TOP_Z + 19], [32, SHELL_TOP_Z + 26]], C.charcoal);
    decal(g, circle(x, y, 22, 32), SHELL_TOP_Z + 26.2, '#4A5068', p);
    decal(g, circle(x, y, 12, 24), SHELL_TOP_Z + 26.3, '#5A6180', p, 0, 1001);
  }
}, [0, 0, 450], [0, -52, 60]);

const dpad = mk('dpad', (g) => {
  const shape = plus(DPAD[0], DPAD[1], 34, 56);
  const p = loft(g, [ring(shape, SHELL_TOP_Z), ring(shape, SHELL_TOP_Z + 10), ring(inset(shape, 3), SHELL_TOP_Z + 14)], {color: C.charcoal});
  const z = SHELL_TOP_Z + 14.2;
  const tri = (cx: number, cy: number, dx: number, dy: number): V2[] =>
    ccw([[cx + dx * 9, cy + dy * 9], [cx - dy * 7, cy + dx * 7], [cx + dy * 7, cy - dx * 7]]);
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as V2[]) decal(g, tri(DPAD[0] + dx * 36, DPAD[1] + dy * 36, dx, dy), z, '#6A7190', p);
  decal(g, circle(DPAD[0], DPAD[1], 8, 20), z, '#272C3D', p);
}, [0, 0, 450], [DPAD[0], DPAD[1], 52]);

const buttons = mk('buttons', (g) => {
  BTN_OFF.forEach(([dx, dy], i) => {
    const x = BTN[0] + dx;
    const y = BTN[1] + dy;
    const p = cyl(g, x, y, [[19, SHELL_TOP_Z], [19, SHELL_TOP_Z + 9], [16.5, SHELL_TOP_Z + 13], [12, SHELL_TOP_Z + 14.5]], C.button);
    // repères génériques : 1 à 4 points
    const n = i + 1;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.PI / 4;
      const r = n === 1 ? 0 : 5.5;
      decal(g, circle(x + r * Math.cos(a), y + r * Math.sin(a), 2.4, 10), SHELL_TOP_Z + 14.7, C.charcoal, p);
    }
  });
}, [0, 0, 450], [BTN[0], BTN[1], 52]);

const trigger = (sgn: number) => mk(sgn < 0 ? 'triggerL' : 'triggerR', (g) => {
  const trig: V2[] = ccw([[148, 6], [178, 3], [204, 13], [217, 32], [213, 47], [197, 50], [182, 36], [164, 31], [148, 31]]);
  const bump: V2[] = ccw(roundRect(150, 37, 44, 14, 6, 3));
  const [x0, x1] = sgn > 0 ? [150, 238] : [-238, -150];
  loft(g, [ring(bump, x0 + 6), ring(bump, x1 - 6)], {color: C.charcoal, axis: 'x'});
  loft(g, [ring(trig, x0 + 14), ring(trig, x1 - 14)], {color: C.trigger, axis: 'x'});
}, [-sgn * 40, 40, 470], [sgn * 194, 175, 28], {axis: 'x', deg: -16});

const membrane = mk('membrane', (g) => {
  for (const c of [DPAD, BTN]) {
    const p = cyl(g, c[0], c[1], [[60, 38], [60, 41]], C.membrane, undefined, 40);
    void p;
    const offs: V2[] = c === BTN ? BTN_OFF : [[36, 0], [0, 36], [-36, 0], [0, -36]];
    for (const [dx, dy] of offs) cyl(g, c[0] + dx, c[1] + dy, [[13, 41], [12, 45], [8, 48]], C.membrane, undefined, 20);
  }
}, [0, 0, 135], [0, 32, 42]);

const modules = mk('modules', (g) => {
  for (const [x, y] of STICKS) {
    const box = roundRect(x, y, 52, 52, 5, 2);
    loft(g, [ring(box, 26), ring(box, 34), ring(inset(box, 3), 37)], {color: C.module});
    cyl(g, x, y, [[19, 37], [18, 41], [14, 45], [8, 47]], C.dome, undefined, 28, 1);
    cyl(g, x, y, [[4.5, 47], [4.5, 60]], C.button, undefined, 14, 2);
    // potentiomètres latéraux
    loft(g, [ring(roundRect(x + 32, y, 12, 22, 2, 1), 27), ring(roundRect(x + 32, y, 12, 22, 2, 1), 35)], {color: C.chip, layer: 1});
    loft(g, [ring(roundRect(x, y - 32, 22, 12, 2, 1), 27), ring(roundRect(x, y - 32, 22, 12, 2, 1), 35)], {color: C.chip, layer: 1});
  }
}, [0, 0, 135], [0, -52, 36]);

const PCB_OUT = ccw(catmullClosed([
  [0, 118], [150, 120], [228, 92], [244, 20], [228, -48], [192, -92], [120, -108], [0, -110],
  [-120, -108], [-192, -92], [-228, -48], [-244, 20], [-228, 92], [-150, 120],
], 5));

const pcb = mk('pcb', (g) => {
  const p = loft(g, [ring(PCB_OUT, 21), ring(PCB_OUT, 25)], {color: C.pcb});
  const z = 25.2;
  // pistes
  for (const c of [DPAD, BTN]) {
    const offs: V2[] = c === BTN ? BTN_OFF : [[36, 0], [0, 36], [-36, 0], [0, -36]];
    for (const [dx, dy] of offs) {
      decal(g, circle(c[0] + dx, c[1] + dy, 13, 20), z, C.pad, p);
      decal(g, circle(c[0] + dx, c[1] + dy, 6, 14), z, C.pcb, p, 0, 1001);
    }
  }
  const trace = (x0: number, y0: number, x1: number, y1: number) => {
    const w = 2.2;
    const L = Math.hypot(x1 - x0, y1 - y0);
    const nx = (-(y1 - y0) / L) * w;
    const ny = ((x1 - x0) / L) * w;
    decal(g, ccw([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]), z, '#5DB894', p, 0, 999);
  };
  trace(-150, 32, -40, 32); trace(150, 32, 40, 32); trace(-40, 32, -40, 70); trace(40, 32, 40, 70);
  trace(0, 0, 0, -80); trace(-60, -40, -60, -90); trace(60, -40, 60, -90); trace(-200, -20, -60, -20); trace(200, -20, 60, -20);
  // composants
  const box = (x: number, y: number, w: number, h: number, t: number, col: string) => {
    const r = roundRect(x, y, w, h, 2, 1);
    loft(g, [ring(r, 25), ring(r, 25 + t)], {color: col, layer: 1});
  };
  box(0, 20, 52, 52, 6, C.chip);
  box(-70, 70, 26, 18, 4, C.chip);
  box(70, 70, 26, 18, 4, C.chip);
  box(0, 100, 40, 14, 8, '#C9CED8'); // connecteur
  box(-150, 95, 16, 10, 3, C.chip);
  box(150, 95, 16, 10, 3, C.chip);
  for (const [x, y] of [[-40, -60], [40, -60], [-110, 75], [110, 75]] as V2[]) {
    loft(g, [ring(circle(x, y, 6, 16), 25), ring(circle(x, y, 6, 16), 35)], {color: '#3B4560', topColor: '#C9CED8', layer: 1});
  }
  decal(g, circle(0, 50, 5, 14), z, '#FFFFFF', p);
}, [0, 0, 0], [0, 0, 24]);

const battery = mk('battery', (g) => {
  const r = roundRect(0, 6, 200, 76, 14, 4);
  const p = loft(g, [ring(r, 2), ring(r, 16), ring(inset(r, 3), 20)], {color: C.battery});
  decal(g, roundRect(-34, 6, 64, 73, 2, 1), 20.2, C.band, p);
  const z = 20.4;
  decal(g, ccw([[60, 4], [78, 4], [78, 8], [60, 8]]), z, C.band, p);
  decal(g, ccw([[67, -3], [71, -3], [71, 15], [67, 15]]), z, C.band, p, 0, 1001);
  decal(g, ccw([[-36, 2], [-32, 2], [-32, 10], [-36, 10]]), 20.6, C.battery, p, 0, 1002);
}, [0, 0, -175], [0, 6, 11]);

const motor = (mx: number) => mk(mx < 0 ? 'motorL' : 'motorR', (g) => {
  const s = Math.sign(mx);
  const o = {axis: 'y' as const, offset: [0, 0, 16] as V3};
  loft(g, [ring(circle(0, mx, 14, 28), -160), ring(circle(0, mx, 14, 28), -96)], {color: C.motor, ...o});
  loft(g, [ring(circle(0, mx, 9, 20), -96), ring(circle(0, mx, 9, 20), -89)], {color: C.chip, ...o});
  loft(g, [ring(circle(0, mx, 2.6, 10), -170), ring(circle(0, mx, 2.6, 10), -160)], {color: C.motor, ...o});
  const halfDisc: V2[] = ccw(Array.from({length: 13}, (_, k) => {
    const a = (k / 12) * Math.PI;
    return [13 * Math.cos(a), mx + 13 * Math.sin(a) * s] as V2;
  }));
  loft(g, [ring(halfDisc, -184), ring(halfDisc, -170)], {color: C.brass, ...o});
}, [Math.sign(mx) * 20, -40, -175], [mx, -130, 16]);

export const MOTOR_WEIGHT_PIECE = 3;

export const PARTS = {
  screws: [0, 1, 2, 3].map(screw),
  triggerL: trigger(-1), triggerR: trigger(1), bottomShell, battery, motorL: motor(MOTORS[0]), motorR: motor(MOTORS[1]), pcb, modules, membrane, topShell, dpad, buttons, stickCaps,
};
