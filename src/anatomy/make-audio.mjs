// Bande-son de « Anatomy » : musique + sons mécaniques, synthèse pure, sans dépendance.
// 120 BPM : un temps = 0,5 s = 15 images à 30 i/s. Écrit public/anatomy/anatomy.wav
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
const fr = (f) => f / 30; // image -> secondes

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

// ---------- instruments ----------
const kick = (t, amp = 0.9) => {
  let ph = 0;
  span(t, 0.45, (i, x) => {
    const f = 44 + 120 * Math.exp(-x * 32);
    ph += (2 * Math.PI * f) / SR;
    const v = Math.sin(ph) * Math.exp(-x * 8) + noise() * Math.exp(-x * 700) * 0.25;
    put(i, v * amp);
  });
};

const hat = (t, amp = 0.18, pan = 0.2, decay = 60) => {
  const hp = new Biquad('hp', 7500, 0.7);
  span(t, 0.12, (i, x) => put(i, hp.run(noise()) * Math.exp(-x * decay) * amp, pan));
};

const tick = (t, amp = 0.2, freq = 3000, pan = 0, send = 0.05) => {
  const bp = new Biquad('bp', freq, 9);
  span(t, 0.07, (i, x) => {
    const v = bp.run(noise() * Math.exp(-x * 500)) * 3 + Math.sin(2 * Math.PI * freq * 0.5 * x) * Math.exp(-x * 140) * 0.3;
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

const whoosh = (t, dur, amp, f0, f1, pan0 = 0, pan1 = 0) => {
  const bp = new Biquad('bp', f0, 1.8);
  span(t, dur, (i, x, k) => {
    const u = x / dur;
    if (k % 64 === 0) bp.set('bp', f0 * Math.pow(f1 / f0, u), 1.8);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u)), 2);
    put(i, bp.run(noise()) * env * amp, pan0 + (pan1 - pan0) * u, 0.1);
  });
};

const ratchet = (t, n, rate, amp, freq, pan = 0, accel = 1) => {
  let tt = t;
  let dt = 1 / rate;
  for (let k = 0; k < n; k++) {
    tick(tt, amp * (0.75 + 0.25 * rnd()), freq * (0.92 + 0.16 * rnd()), pan, 0.03);
    tt += dt;
    dt *= accel;
  }
};

const servo = (t, dur, f0, f1, amp, pan) => {
  const lp = new Biquad('lp', 1400, 0.9);
  let ph = 0;
  span(t, dur, (i, x) => {
    const u = x / dur;
    const f = f0 + (f1 - f0) * Math.sin((Math.PI / 2) * Math.min(1, u * 1.6));
    ph += f / SR;
    const saw = 2 * (ph % 1) - 1;
    const env = Math.min(1, x / 0.03) * Math.min(1, (dur - x) / 0.08);
    put(i, lp.run(saw + noise() * 0.15) * env * amp, pan, 0.05);
  });
};

const blip = (t, freq, amp = 0.15, pan = 0, send = 0.2) => {
  span(t, 0.25, (i, x) => {
    const v = (Math.sin(2 * Math.PI * freq * x) + 0.3 * Math.sin(4 * Math.PI * freq * x)) * Math.exp(-x * 22) * Math.min(1, x / 0.002);
    put(i, v * amp, pan, send);
  });
};

const bassNote = (t, dur, freq, amp = 0.32) => {
  const lp = new Biquad('lp', 600, 1.2);
  let ph = 0;
  span(t, dur + 0.04, (i, x, k) => {
    ph += freq / SR;
    const saw = 2 * (ph % 1) - 1;
    const sq = ph % 1 < 0.5 ? 1 : -1;
    if (k % 32 === 0) lp.set('lp', 180 + 1100 * Math.exp(-x * 14), 1.4);
    const env = Math.min(1, x / 0.004) * (0.55 + 0.45 * Math.exp(-x * 8)) * Math.min(1, Math.max(0, (dur + 0.04 - x) / 0.04));
    const v = lp.run(saw * 0.7 + sq * 0.3) + Math.sin(2 * Math.PI * freq * x) * 0.5;
    put(i, v * env * amp);
  });
};

const pluck = (t, freq, amp = 0.22, pan = 0, dur = 0.9) => {
  const p = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(p);
  let prev = 0;
  for (let k = 0; k < p; k++) {
    prev = prev * 0.5 + noise() * 0.5;
    buf[k] = prev;
  }
  span(t, dur, (i, x, k) => {
    const j = k % p;
    const v = buf[j];
    buf[j] = 0.5 * (buf[j] + buf[(j + 1) % p]) * 0.994;
    put(i, v * amp * Math.min(1, (dur - x) / 0.1), pan, 0.25);
  });
};

const pad = (t, dur, freqs, amp = 0.08, att = 0.5, rel = 0.8) => {
  const voices = [];
  for (const f of freqs) for (const d of [-0.006, 0, 0.007]) voices.push({f: f * (1 + d), ph: rnd(), pan: d * 90});
  const lpL = new Biquad('lp', 1500, 0.7);
  const lpR = new Biquad('lp', 1500, 0.7);
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

const riser = (t, dur, amp) => {
  const bp = new Biquad('bp', 400, 2);
  let ph = 0;
  span(t, dur, (i, x, k) => {
    const u = x / dur;
    if (k % 64 === 0) bp.set('bp', 400 * Math.pow(18, u), 2.2);
    const f = 180 * Math.pow(4, u);
    ph += f / SR;
    const v = bp.run(noise()) * 1.4 + Math.sin(2 * Math.PI * ph) * 0.25;
    put(i, v * amp * u * u, Math.sin(u * 12) * 0.3, 0.15);
  });
};

// ---------- notes ----------
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// accords (midi) par mesure de 4 temps ; mesure 0 = intro
const CHORDS = {
  1: [57, 60, 64], // Am
  2: [53, 57, 60], // F
  3: [48, 52, 55], // C
  4: [55, 59, 62], // G
  5: [57, 60, 64], // Am
  6: [53, 57, 60], // F
};
const chordAtBeat = (b) => (b >= 26 && b < 28 ? [52, 56, 59] : CHORDS[Math.floor(b / 4)] ?? [57, 60, 64]);

// ---------- musique ----------
// intro : nappe + tic-tac
pad(0, 2.4, [hz(57), hz(60), hz(64)], 0.085, 0.4, 0.8);
for (let s = 0; s < 8; s++) tick(s * 0.25, s % 2 ? 0.14 : 0.21, s % 2 ? 2600 : 3400, s % 2 ? 0.3 : -0.3);
blip(0.05, hz(81), 0.06, 0, 0.4);
blip(1.5, hz(76), 0.05, 0, 0.4);
clack(1.5, 0.3, 2000, 320, 0); clack(fr(56), 0.35, 1200, 200, 0);

for (let b = 4; b < 27; b++) {
  const t = b * BEAT;
  kick(t, b === 4 ? 0.95 : 0.8);
  hat(t + 0.25, 0.16, 0.25);
  // tic-tac 16e très léger (horlogerie)
  tick(t + 0.125, 0.05, 4200, -0.4, 0.02);
  tick(t + 0.375, 0.05, 4200, 0.4, 0.02);
  // basse
  const ch = chordAtBeat(b);
  const root = hz(ch[0] - 24);
  const step = (b % 2) * 4;
  const pat = [[0, root], [2, root], [3, root * 2], [5, root], [6, root * 2], [7, root * 1.5]];
  for (const [s, f] of pat) if (s >= step && s < step + 4) bassNote(t + (s - step) * 0.125, 0.11, f, 0.3);
  // clank métallique sur 2 et 4 dans la seconde moitié
  if (b >= 16 && b % 2 === 1) metal(t, 0.07, 420, 0.15, 14, 0.2);
}
// arpège pincé à partir du temps 8
for (let b = 8; b < 27; b++) {
  const ch = chordAtBeat(b);
  const tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24];
  const pat = [0, 2, 1, 3];
  for (let s = 0; s < 2; s++) {
    const idx = pat[((b * 2 + s) % 4)];
    pluck(b * BEAT + s * 0.25, hz(tones[idx]), 0.13, s ? 0.35 : -0.35, 0.6);
  }
}
// nappe de fond pendant la vue éclatée
pad(6.0, 7.6, [hz(55), hz(59), hz(62), hz(67)].map((f) => f * 0.5), 0.025, 2.0, 1.0);

// surbrillance des étiquettes : bips sur chaque croche, images 240 -> 330
const PENTA = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
for (let k = 0; k < 12; k++) blip(fr(240) + k * 0.25, hz(PENTA[k]), 0.07, k % 2 ? 0.4 : -0.4, 0.3);

// ---------- sons mécaniques calés sur les pièces ----------
// 01 vis (images 60, 63, 66, 69)
[60, 63, 66, 69].forEach((f, i) => {
  const t = fr(f);
  const pan = i % 2 ? 0.45 : -0.45;
  ratchet(t - 0.06, 5, 55, 0.22, 3300, pan, 0.9);
  metal(t + 0.3, 0.05, 1900 + i * 140, pan, 30, 0.15);
});
// 02 capuchons
clack(fr(75), 0.45, 1400, 260, 0.3); whoosh(fr(75), 0.32, 0.25, 700, 2600, 0.1, 0.4); tick(fr(75) + 0.3, 0.12, 2400, 0.3);
// 03 croix
clack(fr(90), 0.45, 1800, 300, -0.35); whoosh(fr(90), 0.3, 0.22, 800, 2800, -0.1, -0.4); tick(fr(90) + 0.3, 0.12, 2600, -0.3);
// 04 boutons : quatre clics
for (let k = 0; k < 4; k++) clack(fr(105) + k * 0.0625, 0.28, 2400 + k * 200, 420, 0.4);
whoosh(fr(105), 0.3, 0.2, 900, 3000, 0.2, 0.45);
// 05 coque supérieure
clack(fr(120), 0.7, 900, 150, -0.1); whoosh(fr(120), 0.45, 0.35, 300, 1600, 0, -0.2); tick(fr(120) + 0.35, 0.15, 1500, -0.2);
// 06 gâchettes : clic + ressort
clack(fr(135), 0.45, 1300, 240, 0.35);
span(fr(135) + 0.02, 0.35, (i, x) => put(i, Math.sin(2 * Math.PI * (380 + 60 * Math.sin(x * 70)) * x) * Math.exp(-x * 12) * 0.12, 0.35, 0.2));
whoosh(fr(135), 0.3, 0.2, 600, 2000, 0.2, 0.5);
// 07 membranes : pouf mou
{
  const lp = new Biquad('lp', 700, 1);
  span(fr(150), 0.18, (i, x) => put(i, lp.run(noise()) * Math.exp(-x * 25) * 0.5, -0.35, 0.1));
  span(fr(150) + 0.03, 0.2, (i, x) => put(i, Math.sin(2 * Math.PI * (700 - 1500 * x) * x) * Math.exp(-x * 18) * 0.12, -0.3, 0.2));
  whoosh(fr(150), 0.28, 0.15, 500, 1500, -0.2, -0.4);
}
// 08 modules analogiques
ratchet(fr(165) - 0.02, 4, 40, 0.18, 2200, 0.35, 1);
clack(fr(165), 0.38, 2100, 330, 0.35); whoosh(fr(165), 0.3, 0.18, 800, 2400, 0.2, 0.4);
// 09 coque inférieure (descend)
clack(fr(180), 0.72, 850, 130, -0.15); whoosh(fr(180), 0.45, 0.32, 1700, 300, 0, -0.25); kick(fr(180) + 0.33, 0.25);
// 10 batterie : grésillement électrique
{
  const bp = new Biquad('bp', 900, 1.2);
  span(fr(195), 0.22, (i, x) => {
    const sq = Math.sin(2 * Math.PI * 120 * x) > 0 ? 1 : -1;
    put(i, bp.run(sq * 0.6 + noise() * 0.6) * Math.exp(-x * 9) * 0.28, 0.35, 0.1);
  });
  clack(fr(195), 0.35, 1500, 200, 0.35); whoosh(fr(195), 0.32, 0.18, 1400, 400, 0.3, 0.3);
}
// 11 moteurs de vibration : vrombissement
servo(fr(210), 0.75, 70, 150, 0.16, -0.5);
servo(fr(213), 0.75, 74, 156, 0.16, 0.5);
clack(fr(210), 0.32, 1200, 180, -0.4);
// 12 circuit imprimé : bips numériques
[0, 0.0625, 0.125].forEach((d, k) => blip(fr(225) + d, [2093, 2637, 3136][k], 0.09, 0.3, 0.25));
clack(fr(225), 0.25, 2600, 380, 0.3);

// étiquettes qui se rétractent (images 394 -> 405) : cliquetis qui accélère
ratchet(fr(394), 9, 22, 0.12, 3800, 0, 0.82);
// montée puis aspiration jusqu'à l'impact
riser(11.6, 14.0 - 11.6, 0.22);
{
  const bp = new Biquad('bp', 300, 1.3);
  span(fr(408), 14.0 - fr(408), (i, x, k) => {
    const u = x / (14.0 - fr(408));
    if (k % 64 === 0) bp.set('bp', 300 * Math.pow(14, u), 1.3);
    put(i, bp.run(noise()) * u * u * u * 0.9, 0, 0.2);
  });
}

// ---------- impact : tout se remonte (image 420 = 14,0 s) ----------
{
  const t = 14.0;
  let ph = 0;
  span(t, 1.0, (i, x) => {
    const f = 32 + 70 * Math.exp(-x * 14);
    ph += (2 * Math.PI * f) / SR;
    put(i, Math.sin(ph) * Math.exp(-x * 3.2) * 0.95);
  });
  clack(t, 1.0, 1100, 180, 0);
  clack(t + 0.004, 0.6, 2400, 300, 0.2);
  metal(t, 0.22, 233, -0.1, 2.2, 0.5);
  metal(t, 0.12, 587, 0.15, 3, 0.5);
  const lp = new Biquad('lp', 2500, 0.8);
  span(t, 0.35, (i, x) => put(i, lp.run(noise()) * Math.exp(-x * 14) * 0.5, 0, 0.3));
  // accord final : la mineur + 9
  pad(t, 1.0, [hz(45), hz(57), hz(60), hz(64), hz(71)], 0.07, 0.01, 0.95);
  for (const [k, m] of [69, 72, 76, 83].entries()) pluck(t + 0.05 + k * 0.06, hz(m), 0.14, (k - 1.5) * 0.25, 0.95);
  tick(14.5, 0.1, 3000, -0.3);
  tick(14.75, 0.07, 3000, 0.3);
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
  const fadeOut = Math.min(1, (N - n) / (SR * 0.05));
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
const out = join(here, '..', '..', 'public', 'anatomy', 'anatomy.wav');
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, data);
console.log('écrit', out, (data.length / 1e6).toFixed(2), 'Mo, crête avant normalisation', peak.toFixed(3));
