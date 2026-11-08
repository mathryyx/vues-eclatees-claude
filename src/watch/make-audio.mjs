// Bande-son de « Watch » (FIG. 03) : boîte à musique + tic-tac d'échappement, synthèse pure, sans dépendance.
// 120 BPM : un temps = 0,5 s = 15 images. Balancier à 3 Hz = 21 600 alternances/h = un tic toutes les 5 images,
// soit trois tics par temps (triolets de croches). Écrit public/watch/watch.wav
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SR = 44100;
const DUR = 15.0;
const N = Math.round(SR * DUR);
const L = new Float32Array(N);
const R = new Float32Array(N);
const SEND = new Float32Array(N);
const BEAT = 0.5;
const TRIP = BEAT / 3;
const fr = (f) => f / 30; // image -> secondes

// mêmes repères que Watch.tsx
const STOP = 150;
const IMPACT = 420;
const START = {glass: 60, case: 75, crown: 84, hands: 90, dial: 105, plate: 120, fond: 135, ponts: 150, rubis: 157,
  barrel: 165, train: 180, escape: 195, anchor: 210, balance: 225};
const HL0 = 252;

let seed = 20261108;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;

const put = (i, v, pan = 0, send = 0) => {
  if (i < 0 || i >= N) return;
  const a = ((pan + 1) * Math.PI) / 4;
  L[i] += v * Math.cos(a);
  R[i] += v * Math.sin(a);
  SEND[i] += v * send;
};

class Biquad {
  constructor(type, f, q) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(type, f, q);
  }
  set(type, f, q) {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    const a0 = 1 + al;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const span = (t, dur, fn) => {
  const i0 = Math.round(t * SR);
  const n = Math.round(dur * SR);
  for (let k = 0; k < n; k++) fn(i0 + k, k / SR, k);
};
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- instruments ----------
// tic d'échappement : deux petits chocs (dégagement + impulsion) à 1,2 ms d'écart, résonance de boîte
const escTick = (t, amp, tone, pan) => {
  for (const [dt, a, f] of [[0, 1, tone], [0.0012, 0.55, tone * 1.37], [0.0035, 0.3, tone * 0.72]]) {
    const bp = new Biquad('bp', f, 7);
    span(t + dt, 0.05, (i, x) => put(i, bp.run(noise() * Math.exp(-x * 900)) * 3.2 * a * amp, pan, 0.06));
  }
  span(t, 0.08, (i, x) => put(i, Math.sin(2 * Math.PI * 1650 * x) * Math.exp(-x * 90) * 0.12 * amp, pan, 0.04));
};

const kick = (t, amp = 0.8) => {
  let ph = 0;
  span(t, 0.42, (i, x) => {
    const f = 46 + 110 * Math.exp(-x * 30);
    ph += (2 * Math.PI * f) / SR;
    put(i, (Math.sin(ph) * Math.exp(-x * 8.5) + noise() * Math.exp(-x * 800) * 0.2) * amp);
  });
};

const shaker = (t, amp = 0.1, pan = 0.25) => {
  const hp = new Biquad('hp', 6500, 0.7);
  span(t, 0.09, (i, x) => put(i, hp.run(noise()) * Math.min(1, x / 0.006) * Math.exp(-x * 55) * amp, pan));
};

// boîte à musique : partiels de lame métallique (légèrement inharmoniques)
const mbox = (t, freq, amp = 0.16, pan = 0, dur = 1.6, send = 0.35) => {
  const parts = [[1, 1, 3.2], [2.0, 0.28, 6], [3.01, 0.12, 9], [4.17, 0.1, 14], [5.43, 0.05, 20]];
  span(t, dur, (i, x) => {
    let v = 0;
    for (const [r, a, d] of parts) v += Math.sin(2 * Math.PI * freq * r * x) * a * Math.exp(-x * d);
    v *= Math.min(1, x / 0.0015) * Math.min(1, (dur - x) / 0.05);
    put(i, v * amp, pan, send);
  });
};

const clack = (t, amp = 0.5, freq = 1600, body = 300, pan = 0) => {
  const bp = new Biquad('bp', freq, 3.5);
  const bp2 = new Biquad('bp', freq * 2.3, 6);
  span(t, 0.2, (i, x) => {
    const n = noise() * Math.exp(-x * 260);
    const v = bp.run(n) * 2.2 + bp2.run(n) * 1.2 + Math.sin(2 * Math.PI * body * x) * Math.exp(-x * 45) * 0.6;
    put(i, v * amp, pan, 0.12);
  });
};

const metal = (t, amp = 0.3, base = 600, pan = 0, decay = 6, send = 0.25) => {
  const ratios = [1, 2.76, 5.4, 8.93, 13.34];
  const amps = [1, 0.6, 0.38, 0.22, 0.12];
  span(t, Math.min(3, 7 / decay), (i, x) => {
    let v = 0;
    for (let k = 0; k < ratios.length; k++) v += Math.sin(2 * Math.PI * base * ratios[k] * x) * amps[k] * Math.exp(-x * decay * (1 + k * 0.7));
    v += noise() * Math.exp(-x * 400) * 0.4;
    put(i, v * amp, pan, send);
  });
};

const glassPing = (t, amp = 0.25, pan = 0) => {
  const parts = [[2350, 1, 5], [3720, 0.6, 7], [5210, 0.4, 9], [7480, 0.25, 12]];
  span(t, 1.3, (i, x) => {
    let v = 0;
    for (const [f, a, d] of parts) v += Math.sin(2 * Math.PI * f * x + Math.sin(x * 31) * 0.3) * a * Math.exp(-x * d);
    put(i, v * amp * Math.min(1, x / 0.001), pan, 0.5);
  });
};

const whoosh = (t, dur, amp, f0, f1, pan0 = 0, pan1 = 0) => {
  const bp = new Biquad('bp', f0, 1.8);
  span(t, dur, (i, x, k) => {
    const u = x / dur;
    if (k % 64 === 0) bp.set('bp', f0 * Math.pow(f1 / f0, u), 1.8);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u)), 2);
    put(i, bp.run(noise()) * env * amp, pan0 + (pan1 - pan0) * u, 0.1);
  });
};

const click = (t, amp = 0.2, freq = 3000, pan = 0, send = 0.05) => {
  const bp = new Biquad('bp', freq, 9);
  span(t, 0.06, (i, x) => put(i, bp.run(noise() * Math.exp(-x * 520)) * 3 * amp, pan, send));
};

const ratchet = (t, n, rate, amp, freq, pan = 0, accel = 1) => {
  let tt = t;
  let dt = 1 / rate;
  for (let k = 0; k < n; k++) {
    click(tt, amp * (0.75 + 0.25 * rnd()), freq * (0.92 + 0.16 * rnd()), pan, 0.03);
    tt += dt;
    dt *= accel;
  }
};

const blip = (t, freq, amp = 0.15, pan = 0, send = 0.25) => {
  span(t, 0.3, (i, x) => {
    const v = (Math.sin(2 * Math.PI * freq * x) + 0.25 * Math.sin(4 * Math.PI * freq * x)) * Math.exp(-x * 18) * Math.min(1, x / 0.002);
    put(i, v * amp, pan, send);
  });
};

const bassNote = (t, dur, freq, amp = 0.3) => {
  const lp = new Biquad('lp', 500, 1.2);
  let ph = 0;
  span(t, dur + 0.05, (i, x, k) => {
    ph += freq / SR;
    const tri = 1 - 4 * Math.abs((ph % 1) - 0.5);
    const saw = 2 * (ph % 1) - 1;
    if (k % 32 === 0) lp.set('lp', 160 + 900 * Math.exp(-x * 12), 1.3);
    const env = Math.min(1, x / 0.004) * (0.6 + 0.4 * Math.exp(-x * 7)) * Math.min(1, Math.max(0, (dur + 0.05 - x) / 0.05));
    put(i, (lp.run(saw * 0.6) + tri * 0.6) * env * amp);
  });
};

const pad = (t, dur, freqs, amp = 0.06, att = 0.5, rel = 0.8) => {
  const voices = [];
  for (const f of freqs) for (const d of [-0.005, 0, 0.006]) voices.push({f: f * (1 + d), ph: rnd(), pan: d * 90});
  const lpL = new Biquad('lp', 1300, 0.7);
  const lpR = new Biquad('lp', 1300, 0.7);
  span(t, dur, (i, x) => {
    let l = 0;
    let r = 0;
    for (const v of voices) {
      v.ph += v.f / SR;
      const s = 2 * (v.ph % 1) - 1;
      l += s * (0.5 - v.pan * 0.4);
      r += s * (0.5 + v.pan * 0.4);
    }
    const env = Math.min(1, x / att) * Math.min(1, Math.max(0, (dur - x) / rel));
    if (i >= 0 && i < N) {
      L[i] += lpL.run(l) * env * amp;
      R[i] += lpR.run(r) * env * amp;
      SEND[i] += (l + r) * env * amp * 0.1;
    }
  });
};

const spring = (t, amp = 0.2, f0 = 420, pan = 0) => {
  // ressort : sinus à vibrato rapide + grésillement de spires
  const bp = new Biquad('bp', 2500, 4);
  span(t, 0.7, (i, x) => {
    const f = f0 * (1 + 0.18 * Math.sin(2 * Math.PI * 23 * x) * Math.exp(-x * 4)) * (1 - 0.15 * x);
    const v = Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 5) + bp.run(noise()) * Math.exp(-x * 14) * 0.6;
    put(i, v * amp, pan, 0.25);
  });
};

const riser = (t, dur, amp) => {
  const bp = new Biquad('bp', 400, 2);
  span(t, dur, (i, x, k) => {
    const u = x / dur;
    if (k % 64 === 0) bp.set('bp', 400 * Math.pow(16, u), 2.2);
    put(i, bp.run(noise()) * 1.3 * amp * u * u, Math.sin(u * 12) * 0.3, 0.15);
  });
};

// ---------- harmonie (ré mineur, cadence vers ré majeur au remontage) ----------
const CH = {
  0: [62, 65, 69], 1: [62, 65, 69], 2: [58, 62, 65], 3: [57, 60, 65], 4: [55, 60, 64], 5: [57, 62, 65],
};
const chordAtBeat = (b) => (b >= 26 && b < 28 ? [57, 61, 64] : b >= 24 && b < 26 ? [55, 58, 62] : CH[Math.floor(b / 4)] ?? [62, 65, 69]);

// ---------- tic-tac : la montre marche de 0 à STOP, puis à nouveau après l'IMPACT ----------
for (let f = 0; f < STOP; f += 5) {
  const k = f / 5;
  escTick(fr(f), (k % 2 ? 0.34 : 0.42) * (f < 60 ? 1.5 : 1.1), k % 2 ? 2700 : 3500, k % 2 ? 0.25 : -0.25);
}
for (let f = IMPACT + 5; f < 450; f += 5) {
  const k = f / 5;
  escTick(fr(f), (k % 2 ? 0.34 : 0.42) * 1.5 * Math.min(1, (f - IMPACT) / 12), k % 2 ? 2700 : 3500, k % 2 ? 0.25 : -0.25);
}

// ---------- intro (temps 0 à 3) : nappe + boîte à musique ----------
pad(0, 2.3, [hz(50), hz(57), hz(62), hz(65)], 0.05, 0.6, 0.7);
[[0, 81], [0.5, 77], [1.0, 74], [1.5, 76], [1.8333, 77]].forEach(([t, m]) => mbox(t + 0.02, hz(m), 0.17, (m - 77) * 0.06, 1.6));

// ---------- groove (temps 4 à 27) ----------
for (let b = 4; b < 28; b++) {
  const t = b * BEAT;
  kick(t, b === 4 ? 0.9 : 0.72);
  shaker(t + 2 * TRIP, 0.09, 0.3);
  shaker(t + TRIP, 0.04, -0.3);
  const ch = chordAtBeat(b);
  const root = hz(ch[0] - 24);
  bassNote(t, 0.13, root, 0.3);
  bassNote(t + 2 * TRIP, 0.1, b % 2 ? root * 1.5 : root * 2, 0.22);
  if (b >= 16 && b % 2 === 1) metal(t, 0.05, 520, 0.2, 16, 0.2);
}
// arpège de boîte à musique en triolets, à partir du temps 8 (quand le tic-tac s'efface)
for (let b = 8; b < 28; b++) {
  const ch = chordAtBeat(b);
  const tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24];
  const pat = b % 2 ? [3, 2, 1] : [0, 1, 2];
  pat.forEach((idx, s) => mbox(b * BEAT + s * TRIP, hz(tones[idx]), s === 0 ? 0.1 : 0.075, s === 1 ? 0.3 : -0.25, 0.9));
}
// mélodie lente par-dessus (blanches)
[[8, 81, 2], [10, 79, 2], [12, 77, 2], [14, 76, 2], [16, 77, 2], [18, 76, 2], [20, 74, 2], [22, 77, 2], [24, 79, 1], [25, 77, 1], [26, 76, 2]]
  .forEach(([b, m, d]) => mbox(b * BEAT, hz(m), 0.1, 0, Math.min(2, d * 0.5 + 0.8), 0.45));
pad(5.0, 8.6, [hz(50), hz(57)], 0.022, 2.0, 1.2);

// ---------- sons mécaniques calés sur les pièces ----------
glassPing(fr(START.glass), 0.2, -0.1); whoosh(fr(START.glass), 0.4, 0.2, 600, 3200, 0, -0.2);
clack(fr(START.case), 0.55, 1100, 190, -0.15); metal(fr(START.case), 0.12, 380, -0.2, 5, 0.35); whoosh(fr(START.case), 0.4, 0.22, 500, 2200, 0, -0.2);
ratchet(fr(START.crown) - 0.05, 4, 30, 0.2, 3400, 0.5); click(fr(START.crown) + 0.12, 0.3, 2200, 0.5);
[0, 0.06, 0.12].forEach((d, k) => blip(fr(START.hands) + d, hz(93 + k * 3), 0.06, 0.35, 0.3));
whoosh(fr(START.hands), 0.3, 0.12, 1200, 3600, 0.2, 0.4);
whoosh(fr(START.dial), 0.42, 0.2, 400, 1800, -0.2, -0.3); mbox(fr(START.dial), hz(86), 0.07, -0.3, 1.0);
clack(fr(START.plate), 0.6, 900, 150, 0.15); metal(fr(START.plate), 0.1, 300, 0.2, 6, 0.3);
ratchet(fr(START.fond) - 0.18, 6, 34, 0.14, 2600, -0.3, 1.0); whoosh(fr(START.fond), 0.45, 0.25, 1800, 300, -0.1, -0.3); kick(fr(START.fond) + 0.3, 0.18);
// les ponts partent : le rouage perd ses pivots, le tic-tac s'arrête
ratchet(fr(START.ponts) - 0.1, 3, 40, 0.16, 3000, 0.35); clack(fr(START.ponts), 0.5, 1300, 220, 0.3); whoosh(fr(START.ponts), 0.4, 0.2, 1500, 400, 0.2, 0.3);
[0, 0.05, 0.1].forEach((d, k) => blip(fr(START.rubis) + d, hz(98 + k * 2), 0.05, 0.45, 0.4));
spring(fr(START.barrel), 0.17, 400, 0.4); clack(fr(START.barrel), 0.3, 1500, 240, 0.4);
ratchet(fr(START.train) - 0.08, 9, 70, 0.12, 2400, 0.3, 0.97); clack(fr(START.train), 0.3, 1900, 300, 0.3);
escTick(fr(START.escape), 0.5, 3600, -0.35); escTick(fr(START.escape) + TRIP, 0.3, 3600, -0.35);
escTick(fr(START.anchor), 0.5, 2800, -0.4); escTick(fr(START.anchor) + TRIP, 0.4, 3500, -0.4);
mbox(fr(START.balance), hz(93), 0.08, -0.4, 1.2); spring(fr(START.balance), 0.07, 900, -0.4);

// surbrillance des étiquettes : une note par croche
const PENTA = [69, 72, 74, 77, 79, 81, 84, 86, 89, 91, 93, 96, 98, 101];
PENTA.forEach((m, k) => blip(fr(HL0) + k * 0.25, hz(m), 0.06, k % 2 ? 0.35 : -0.35, 0.3));

// étiquettes qui se rétractent (391 -> 403) puis remontage (405 -> 420)
ratchet(fr(391), 10, 24, 0.11, 3800, 0, 0.84);
riser(11.6, 14.0 - 11.6, 0.2);
{
  const bp = new Biquad('bp', 300, 1.3);
  const t0 = fr(405);
  span(t0, 14.0 - t0, (i, x, k) => {
    const u = x / (14.0 - t0);
    if (k % 64 === 0) bp.set('bp', 300 * Math.pow(14, u), 1.3);
    put(i, bp.run(noise()) * u * u * u * 0.85, 0, 0.2);
  });
}

// ---------- impact : tout se remonte (image 420 = 14,0 s), les aiguilles repartent ----------
{
  const t = 14.0;
  let ph = 0;
  span(t, 1.0, (i, x) => {
    const f = 34 + 70 * Math.exp(-x * 14);
    ph += (2 * Math.PI * f) / SR;
    put(i, Math.sin(ph) * Math.exp(-x * 3.4) * 0.9);
  });
  clack(t, 0.95, 1100, 180, 0);
  clack(t + 0.004, 0.55, 2500, 320, 0.2);
  metal(t, 0.2, 293.7, -0.1, 2.2, 0.5);
  metal(t, 0.1, 587, 0.15, 3, 0.5);
  const lp = new Biquad('lp', 2500, 0.8);
  span(t, 0.3, (i, x) => put(i, lp.run(noise()) * Math.exp(-x * 14) * 0.45, 0, 0.3));
  pad(t, 1.0, [hz(38), hz(50), hz(57), hz(62), hz(66)], 0.06, 0.01, 0.95);
  [74, 78, 81, 86].forEach((m, k) => mbox(t + 0.04 + k * 0.05, hz(m), 0.12, (k - 1.5) * 0.25, 0.95, 0.4));
  // mise à l'heure : l'aiguille des minutes fait un tour (420 -> 442), cliquetis qui ralentit
  ratchet(fr(IMPACT + 2), 16, 60, 0.07, 4200, 0.15, 1.07);
}

// ---------- réverbération (Schroeder) ----------
const reverb = (input, offs) => {
  const out = new Float32Array(N);
  const combs = [1557, 1617, 1491, 1422].map((d) => ({d: d + offs, buf: new Float32Array(d + offs), i: 0, lp: 0}));
  const aps = [225, 556].map((d) => ({d: d + offs, buf: new Float32Array(d + offs), i: 0}));
  for (let n = 0; n < N; n++) {
    const x = input[n];
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * 0.72 + c.lp * 0.28;
      c.buf[c.i] = x + c.lp * 0.8;
      c.i = (c.i + 1) % c.d;
      s += y;
    }
    s *= 0.25;
    for (const a of aps) {
      const b = a.buf[a.i];
      const y = -s + b;
      a.buf[a.i] = s + b * 0.5;
      a.i = (a.i + 1) % a.d;
      s = y;
    }
    out[n] = s;
  }
  return out;
};
const rvL = reverb(SEND, 0);
const rvR = reverb(SEND, 23);

// ---------- master ----------
let peak = 0;
const mixL = new Float32Array(N);
const mixR = new Float32Array(N);
for (let n = 0; n < N; n++) {
  const fadeOut = Math.min(1, (N - n) / (SR * 0.06));
  mixL[n] = Math.tanh((L[n] + rvL[n] * 0.9) * 1.1) * fadeOut;
  mixR[n] = Math.tanh((R[n] + rvR[n] * 0.9) * 1.1) * fadeOut;
  peak = Math.max(peak, Math.abs(mixL[n]), Math.abs(mixR[n]));
}
const g = 0.89 / peak;
const data = Buffer.alloc(44 + N * 4);
data.write('RIFF', 0); data.writeUInt32LE(36 + N * 4, 4); data.write('WAVE', 8);
data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixL[n] * g)) * 32767), 44 + n * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixR[n] * g)) * 32767), 46 + n * 4);
}
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'public', 'watch', 'watch.wav');
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, data);
console.log('écrit', out, (data.length / 1e6).toFixed(2), 'Mo, crête avant normalisation', peak.toFixed(3));
