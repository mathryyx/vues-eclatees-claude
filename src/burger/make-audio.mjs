// Bande-son de « Burger » (FIG. 05) : musique + bruitages de cuisine, synthèse pure, sans dépendance.
// 120 BPM : un temps = 0,5 s = 15 images à 30 i/s. Écrit public/burger/burger.wav
// Instruments de base repris du script de la FIG. 01, le reste est propre à cette vidéo.
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

let seed = 20261105;
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


// ---------- instruments propres ----------
const clap = (t, amp = 0.3, pan = 0) => {
  const bp = new Biquad('bp', 1250, 1.1);
  for (const d of [0, 0.011, 0.023]) span(t + d, 0.16, (i, x) => put(i, bp.run(noise()) * Math.exp(-x * (d === 0.023 ? 22 : 90)) * amp * 1.6, pan, 0.25));
};

// marimba : partiels 1, 4, 9.9
const mallet = (t, freq, amp = 0.16, pan = 0, send = 0.22) => {
  span(t, 0.9, (i, x) => {
    const a = Math.min(1, x / 0.0015);
    const v = Math.sin(2 * Math.PI * freq * x) * Math.exp(-x * 5.5)
      + 0.35 * Math.sin(2 * Math.PI * freq * 3.99 * x) * Math.exp(-x * 22)
      + 0.12 * Math.sin(2 * Math.PI * freq * 9.9 * x) * Math.exp(-x * 60);
    put(i, v * a * amp, pan, send);
  });
};

// croquant : grains de bruit filtré
const crunch = (t, dur, amp, pan = 0, f0 = 2400) => {
  const n = Math.round(dur * 90);
  for (let k = 0; k < n; k++) {
    const tt = t + rnd() * dur;
    const bp = new Biquad('bp', f0 * (0.6 + rnd() * 1.4), 2.5);
    const a = amp * (0.4 + rnd() * 0.6) * (1 - (tt - t) / (dur * 1.3));
    span(tt, 0.03, (i, x) => put(i, bp.run(noise()) * Math.exp(-x * 160) * a * 2, pan + (rnd() - 0.5) * 0.3, 0.05));
  }
};

// écrasement mouillé (tomate)
const squish = (t, amp, pan = 0) => {
  const bp = new Biquad('bp', 1800, 2.2);
  span(t, 0.22, (i, x, k) => {
    const u = x / 0.22;
    if (k % 32 === 0) bp.set('bp', 1800 * Math.pow(0.22, u), 2.2 + 3 * u);
    const wob = 1 + 0.6 * Math.sin(2 * Math.PI * 38 * x);
    put(i, bp.run(noise()) * wob * Math.sin(Math.PI * u) * amp * 1.8, pan, 0.12);
  });
  span(t + 0.02, 0.12, (i, x) => put(i, Math.sin(2 * Math.PI * (210 - 500 * x) * x) * Math.exp(-x * 26) * amp * 0.5, pan, 0.1));
};

// « ploc » (cornichons)
const plop = (t, f0, amp, pan = 0) => {
  let ph = 0;
  span(t, 0.12, (i, x) => {
    const f = f0 * (1 + 1.4 * Math.exp(-x * 60));
    ph += f / SR;
    put(i, Math.sin(2 * Math.PI * ph) * Math.exp(-x * 30) * Math.min(1, x / 0.001) * amp, pan, 0.2);
  });
};

// étirement élastique (cheddar)
const stretch = (t, dur, amp, pan = 0) => {
  let ph = 0;
  const lp = new Biquad('lp', 900, 2);
  span(t, dur, (i, x) => {
    const u = x / dur;
    const f = 330 * Math.pow(0.55, u) * (1 + 0.04 * Math.sin(2 * Math.PI * 9 * x));
    ph += f / SR;
    const tri = 1 - 4 * Math.abs((ph % 1) - 0.5);
    const env = Math.min(1, x / 0.02) * Math.pow(1 - u, 1.4);
    put(i, lp.run(tri) * env * amp, pan, 0.18);
  });
};

// grésillement (steak saisi)
const sizzle = (t, dur, amp, pan = 0) => {
  const hp = new Biquad('hp', 3800, 0.7);
  const hp2 = new Biquad('hp', 2000, 0.8);
  span(t, dur, (i, x) => {
    const u = x / dur;
    const env = Math.min(1, x / 0.03) * Math.pow(1 - u, 1.2);
    let v = hp.run(noise()) * 0.35;
    if (rnd() < 0.004) v += (rnd() - 0.5) * 6;
    v = hp2.run(v);
    put(i, v * env * amp, pan + 0.15 * Math.sin(x * 9), 0.08);
  });
};

// « splotch » (sauce)
const splort = (t, amp, pan = 0) => {
  const bp = new Biquad('bp', 700, 3);
  span(t, 0.28, (i, x, k) => {
    const u = x / 0.28;
    if (k % 32 === 0) bp.set('bp', 700 * Math.pow(0.35, u) * (1 + 0.3 * Math.sin(x * 140)), 3);
    const env = Math.min(1, x / 0.01) * Math.pow(1 - u, 2);
    put(i, bp.run(noise()) * env * amp * 2.6, pan, 0.1);
  });
};

// sonnette de comptoir
const bell = (t, amp, pan = 0) => {
  const ratios = [1, 2.32, 4.25, 6.63, 9.38];
  const amps = [1, 0.55, 0.32, 0.18, 0.08];
  const base = 1480;
  span(t, 2.2, (i, x) => {
    let v = 0;
    for (let k = 0; k < ratios.length; k++) {
      const trem = 1 + 0.08 * Math.sin(2 * Math.PI * (4 + k) * x);
      v += Math.sin(2 * Math.PI * base * ratios[k] * x) * amps[k] * Math.exp(-x * (1.6 + k * 1.3)) * trem;
    }
    v += noise() * Math.exp(-x * 900) * 0.6;
    put(i, v * amp, pan, 0.35);
  });
};

// ---------- notes ----------
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// fa majeur, une mesure = 4 temps ; mesure 0 = intro
const CHORDS = {
  1: [53, 57, 60], // F
  2: [50, 53, 57], // Dm
  3: [46, 50, 53], // Bb
  4: [48, 52, 55], // C
  5: [53, 57, 60], // F
  6: [46, 50, 53], // Bb
};
const chordAtBeat = (b) => (b >= 26 && b < 28 ? [48, 52, 55, 58] : CHORDS[Math.floor(b / 4)] ?? [53, 57, 60]);

// ---------- musique ----------
// intro : nappe douce + tic-tac de minuteur de cuisine
pad(0, 2.3, [hz(53), hz(57), hz(60), hz(64)], 0.075, 0.35, 0.8);
for (let s = 0; s < 8; s++) tick(s * 0.25, s % 2 ? 0.13 : 0.2, s % 2 ? 2700 : 3500, s % 2 ? 0.3 : -0.3);
mallet(0.05, hz(77), 0.1, -0.2);
mallet(0.3, hz(81), 0.08, 0.2);
// cote qui se trace
whoosh(0.2, 0.45, 0.08, 1500, 4000, -0.5, 0.5);
// sursaut du temps 3
clack(1.5, 0.3, 1700, 260, 0); mallet(1.5, hz(72), 0.12, 0);
kick(1.75, 0.35);

for (let b = 4; b < 27; b++) {
  const t = b * BEAT;
  // grosse caisse : 1, 3 et le « et » de 2
  if (b % 2 === 0) kick(t, b === 4 ? 0.95 : 0.8);
  if (b % 4 === 1) kick(t + 0.25, 0.5);
  if (b % 2 === 1) clap(t, 0.26, 0.05);
  // charleston 16e, accent sur les contretemps
  for (let s = 0; s < 4; s++) hat(t + s * 0.125, s === 2 ? 0.15 : 0.06, s % 2 ? 0.3 : -0.1, s === 2 ? 45 : 90);
  // basse funky
  const ch = chordAtBeat(b);
  const root = hz(ch[0] - 24);
  const pat = b % 2 === 0 ? [[0, root, 0.2], [0.375, root * 2, 0.09]] : [[0, root * 1.5, 0.09], [0.25, root, 0.12], [0.375, root * 2, 0.08]];
  for (const [d, f, du] of pat) bassNote(t + d, du, f, 0.3);
}
// accords pincés (contretemps) à partir du temps 8
for (let b = 8; b < 27; b++) {
  const ch = chordAtBeat(b);
  ch.slice(0, 3).forEach((m, k) => pluck(b * BEAT + 0.25 + k * 0.012, hz(m + 12), 0.075, (k - 1) * 0.35, 0.35));
}
// petite mélodie de marimba, mesures 3 à 6
const MEL = [
  [12, 72], [12.5, 74], [13, 77], [14, 76], [14.5, 72],
  [16, 69], [16.5, 72], [17, 74], [18, 72], [19, 67],
  [20, 72], [20.5, 74], [21, 77], [22, 79], [22.5, 81],
  [24, 77], [24.5, 74], [25, 72],
];
for (const [b, m] of MEL) mallet(b * BEAT, hz(m), 0.075, 0.25, 0.25);
pad(6.0, 7.4, [hz(53), hz(57), hz(60), hz(65)].map((f) => f * 0.5), 0.022, 2.0, 1.0);

// surbrillance des étiquettes : une note par temps (images 225 -> 345)
const UP = [72, 74, 77, 79, 81, 84, 86, 89, 93];
for (let k = 0; k < 9; k++) {
  const t = fr(225) + k * BEAT;
  mallet(t, hz(UP[k]), 0.13, k % 2 ? 0.45 : -0.45, 0.3);
  blip(t, hz(UP[k] + 12), 0.035, k % 2 ? 0.45 : -0.45, 0.3);
}
// la masse totale s'affiche (image 360)
mallet(fr(360), hz(77), 0.12, 0); mallet(fr(360) + 0.06, hz(84), 0.1, 0.2); mallet(fr(360) + 0.12, hz(89), 0.09, -0.2);

// ---------- bruitages calés sur les couches (une par temps, images 60 -> 180) ----------
const at = (i) => fr(60 + i * 15);
// 01 pain du dessus : envolée + « fwoump »
whoosh(at(0) - 0.05, 0.5, 0.34, 300, 2600, -0.1, -0.4);
{
  const lp = new Biquad('lp', 260, 1.2);
  span(at(0), 0.25, (i, x) => put(i, lp.run(noise()) * Math.exp(-x * 14) * 1.2, -0.2, 0.1));
}
clack(at(0) + 0.42, 0.2, 900, 160, -0.35);
// 02 laitue : croquant
crunch(at(1), 0.26, 0.42, 0.35, 2600); whoosh(at(1), 0.32, 0.18, 600, 2400, 0.1, 0.4);
// 03 tomate : écrasement mouillé
squish(at(2), 0.55, -0.35); whoosh(at(2), 0.3, 0.16, 700, 2200, -0.1, -0.4);
// 04 oignon : craquant net
crunch(at(3), 0.1, 0.4, 0.35, 4200); tick(at(3), 0.3, 3200, 0.35, 0.1); whoosh(at(3), 0.28, 0.14, 900, 2800, 0.2, 0.4);
// 05 cornichons : quatre « plocs »
[0, 0.0625, 0.125, 0.1875].forEach((d, k) => plop(at(4) + d, [620, 540, 700, 480][k], 0.22, -0.35 + k * 0.05));
whoosh(at(4), 0.28, 0.12, 800, 2600, -0.2, -0.4);
// 06 cheddar : étirement
stretch(at(5), 0.42, 0.26, 0.35); whoosh(at(5), 0.3, 0.14, 700, 2200, 0.2, 0.4);
// 07 steak : grésillement + poids
sizzle(at(6), 1.3, 0.34, -0.25); kick(at(6), 0.45); whoosh(at(6), 0.34, 0.2, 400, 1800, -0.1, -0.35);
// 08 sauce : « splotch »
splort(at(7), 0.5, 0.35);
// 09 pain du dessous : petit saut sur place
clack(at(8) + 0.2, 0.42, 700, 120, -0.3); kick(at(8) + 0.2, 0.3);

// étiquettes qui se rétractent (images 394 -> 405) : cliquetis qui accélère
ratchet(fr(394), 9, 22, 0.11, 3800, 0, 0.82);
// chute : aspiration jusqu'à l'impact
riser(12.2, 14.0 - 12.2, 0.3);
whoosh(fr(405), 14.0 - fr(405), 0.8, 3200, 300, 0, 0);

// ---------- impact : tout retombe (image 420 = 14,0 s) ----------
{
  const t = 14.0;
  let ph = 0;
  span(t, 1.0, (i, x) => {
    const f = 36 + 80 * Math.exp(-x * 15);
    ph += (2 * Math.PI * f) / SR;
    put(i, Math.sin(ph) * Math.exp(-x * 3.6) * 0.95);
  });
  // « pof » moelleux du pain
  const lp = new Biquad('lp', 900, 0.9);
  span(t, 0.3, (i, x) => put(i, lp.run(noise()) * Math.exp(-x * 18) * 1.0, 0, 0.25));
  squish(t + 0.01, 0.35, 0.1);
  clack(t, 0.45, 800, 140, 0);
  // accord final : fa majeur 9
  pad(t, 1.0, [hz(41), hz(53), hz(57), hz(60), hz(67)], 0.065, 0.01, 0.95);
  for (const [k, m] of [65, 69, 72, 79].entries()) pluck(t + 0.05 + k * 0.05, hz(m), 0.13, (k - 1.5) * 0.25, 0.95);
  // sonnette : « commande prête »
  bell(t + fr(6), 0.2, 0.15);
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
const out = join(here, '..', '..', 'public', 'burger', 'burger.wav');
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, data);
console.log('écrit', out, (data.length / 1e6).toFixed(2), 'Mo, crête avant normalisation', peak.toFixed(3));
