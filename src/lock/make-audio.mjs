// Bande-son de « Lock » (FIG. 02) : musique + sons mécaniques, synthèse pure, sans dépendance.
// 120 BPM : un temps = 0,5 s = 15 images à 30 i/s. Écrit public/lock/lock.wav
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

let seed = 20261109;
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


// petit « tink » de goupille : métal aigu très court
const tink = (t, amp = 0.16, base = 2600, pan = 0) => metal(t, amp, base, pan, 34, 0.18);
// « pop » de bouchon : chute de hauteur + souffle
const pop = (t, amp = 0.25, f0 = 900, pan = 0) => {
  let ph = 0;
  span(t, 0.12, (i, x) => {
    const f = f0 * Math.exp(-x * 18) + 180;
    ph += (2 * Math.PI * f) / SR;
    put(i, (Math.sin(ph) * Math.exp(-x * 30) + noise() * Math.exp(-x * 300) * 0.3) * amp, pan, 0.15);
  });
};
// ressort : sinus vibré qui s'éteint
const boing = (t, amp = 0.12, f0 = 330, pan = 0) => {
  let ph = 0;
  span(t, 0.45, (i, x) => {
    const f = f0 * (1 + 0.18 * Math.sin(x * 2 * Math.PI * 22) * Math.exp(-x * 6)) * (1 + 0.25 * Math.exp(-x * 12));
    ph += (2 * Math.PI * f) / SR;
    put(i, Math.sin(ph) * Math.exp(-x * 7) * Math.min(1, x / 0.004) * amp, pan, 0.25);
  });
};
// frottement de la clé dans le canal
const scrape = (t, dur, amp = 0.12, f0 = 2400, pan = 0) => {
  const bp = new Biquad('bp', f0, 2.5);
  span(t, dur, (i, x, k) => {
    const u = x / dur;
    if (k % 64 === 0) bp.set('bp', f0 * (0.85 + 0.3 * u), 2.5);
    const env = Math.sin(Math.PI * Math.min(1, u)) ** 0.7;
    const grit = 0.6 + 0.4 * Math.sin(x * 2 * Math.PI * 85);
    put(i, bp.run(noise()) * env * grit * amp, pan, 0.06);
  });
};

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// mi mineur : Em, C, G, D (une mesure = 4 temps), à partir du temps 11
const CH = [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]];
const chordAtBeat = (b) => CH[Math.floor((b - 11) / 4) % 4] ?? CH[0];

// ---------- intro : nappe + horlogerie ----------
pad(0, 5.2, [hz(52), hz(59), hz(64), hz(66)], 0.06, 0.6, 1.2);
for (let s = 0; s < 4; s++) tick(s * 0.25, s % 2 ? 0.11 : 0.17, s % 2 ? 2600 : 3400, s % 2 ? 0.3 : -0.3);
blip(0.05, hz(83), 0.05, 0, 0.4);
// la clé arrive (images 0 -> 27)
whoosh(0.05, 0.85, 0.22, 400, 2600, -0.6, -0.15);
scrape(fr(18), fr(27) - fr(18) + 0.05, 0.1, 2200, -0.2);
tick(fr(27), 0.2, 2800, -0.2);

// ---------- la clé avance cran par cran (images 30, 45, 60, 75, 90) ----------
const STEP_F = [30, 45, 60, 75, 90];
const MEL = [64, 67, 69, 71, 74]; // mi sol la si ré
STEP_F.forEach((f, j) => {
  const t = fr(f);
  const pan = -0.35 + j * 0.17;
  scrape(t, 0.3, 0.11, 2000 + j * 150, pan);
  // les goupilles déjà levées sautent les dents
  for (let k = 0; k < j; k++) tick(t + 0.07 + k * 0.035, 0.08, 3200 + k * 300, pan, 0.03);
  // la nouvelle goupille monte sur la rampe et se pose
  boing(t + 0.05, 0.05, 520 + j * 60, pan);
  tink(t + 0.28, 0.13, 2300 + j * 260, pan);
  clack(t + 0.29, 0.22, 1700, 260, pan);
  pluck(t + 0.29, hz(MEL[j]), 0.15, pan, 0.8);
  kick(t + 0.29, 0.28);
});
// butée de l'épaulement (image 99)
clack(fr(99), 0.75, 1200, 170, 0.1);
kick(fr(99), 0.6);
metal(fr(99), 0.12, 610, 0.1, 5, 0.35);

// ---------- contrôle d'alignement (croches, images 105 -> 135) ----------
const CHK = [76, 79, 81, 83, 86];
[105, 112.5, 120, 127.5, 135].forEach((f, k) => {
  blip(fr(f), hz(CHK[k]), 0.085, -0.4 + k * 0.2, 0.3);
  tick(fr(f), 0.07, 4200, -0.4 + k * 0.2, 0.02);
});
// « déverrouillé » (image 142) : petit accord
for (const [k, m] of [64, 71, 76].entries()) pluck(fr(142) + k * 0.04, hz(m), 0.1, (k - 1) * 0.3, 0.7);

// ---------- rotation d'un quart de tour (images 150 -> 165) ----------
ratchet(fr(150), 7, 16, 0.16, 2600, 0.2, 0.9);
servo(fr(150), 0.5, 60, 110, 0.07, 0.25);
riser(fr(140), fr(165) - fr(140), 0.08);
// la came pousse le pêne : clunk
{
  const t = fr(165);
  kick(t, 1.0);
  clack(t, 0.9, 700, 120, 0.25);
  clack(t + 0.006, 0.45, 2200, 300, 0.3);
  metal(t, 0.16, 247, 0.2, 3, 0.4);
  const lp = new Biquad('lp', 1800, 0.8);
  span(t, 0.3, (i, x) => put(i, lp.run(noise()) * Math.exp(-x * 16) * 0.35, 0.2, 0.25));
}
// retour (images 195 -> 207)
ratchet(fr(195), 6, 18, 0.13, 2300, 0.15, 0.92);
clack(fr(207), 0.35, 1500, 220, 0.15);

// ---------- groove : temps 11 -> 27 ----------
for (let b = 11; b < 27; b++) {
  const t = b * BEAT;
  if (b > 11) kick(t, 0.72);
  hat(t + 0.25, 0.14, 0.25);
  tick(t + 0.125, 0.045, 4200, -0.4, 0.02);
  tick(t + 0.375, 0.045, 4200, 0.4, 0.02);
  const ch = chordAtBeat(b);
  const root = hz(ch[0] - 24);
  const step = (b % 2) * 4;
  const pat = [[0, root], [2, root], [3, root * 2], [5, root], [6, root * 2], [7, root * 1.5]];
  for (const [s, fq] of pat) if (s >= step && s < step + 4) bassNote(t + (s - step) * 0.125, 0.11, fq, 0.27);
  if (b >= 14) {
    const tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24];
    const pp = [0, 2, 1, 3];
    for (let s = 0; s < 2; s++) pluck(t + s * 0.25, hz(tones[pp[(b * 2 + s) % 4]]), 0.1, s ? 0.35 : -0.35, 0.55);
  }
}
pad(fr(165), fr(405) - fr(165), [hz(40), hz(47), hz(52)], 0.03, 1.5, 1.0);

// ---------- vue éclatée : une pièce par temps (images 210 -> 330) ----------
const at = (f) => fr(f);
// 01 bouchons : cinq pops
for (let k = 0; k < 5; k++) pop(at(210) + k * 0.05, 0.22, 1100 + k * 120, 0.1 + k * 0.06);
whoosh(at(210), 0.35, 0.2, 600, 2600, 0, 0.3);
// 02 ressorts
for (let k = 0; k < 5; k++) boing(at(225) + k * 0.035, 0.06, 300 + k * 40, 0.1 + k * 0.06);
whoosh(at(225), 0.32, 0.16, 700, 2400, 0, 0.3);
// 03 contre-goupilles
for (let k = 0; k < 5; k++) tink(at(240) + k * 0.045, 0.12, 2000 + k * 230, 0.05 + k * 0.07);
whoosh(at(240), 0.3, 0.16, 800, 2600, 0, 0.3);
// 04 circlip : claquement de ressort plat
metal(at(255), 0.14, 1800, 0.55, 16, 0.3); tick(at(255), 0.25, 3600, 0.55, 0.1); whoosh(at(255), 0.28, 0.16, 900, 3000, 0.4, 0.7);
// 05 came
clack(at(270), 0.5, 1100, 180, 0.45); metal(at(270), 0.08, 420, 0.45, 9, 0.25); whoosh(at(270), 0.3, 0.18, 600, 2200, 0.3, 0.6);
// 06 rotor : glisse hors du stator
scrape(at(285) - 0.05, 0.4, 0.1, 1500, -0.3); whoosh(at(285), 0.45, 0.3, 2200, 400, 0, -0.5); clack(at(285) + 0.33, 0.35, 900, 150, -0.5);
// 07 goupilles de clé
for (let k = 0; k < 5; k++) tink(at(300) + k * 0.045, 0.12, 1500 + k * 170, -0.45 + k * 0.05);
whoosh(at(300), 0.3, 0.15, 800, 2400, -0.3, -0.4);
// 08 clé : sort du canal
scrape(at(315), 0.35, 0.12, 2600, -0.55); whoosh(at(315), 0.4, 0.22, 1800, 500, -0.3, -0.7); tick(at(315) + 0.36, 0.15, 2500, -0.6);
// 09 stator
kick(at(330), 0.45); metal(at(330), 0.1, 196, 0.1, 4, 0.35); clack(at(330), 0.3, 800, 120, 0.1);

// surbrillance des étiquettes : une croche chacune (images 330 -> 397)
const PENTA = [71, 74, 76, 79, 81, 83, 86, 88, 91];
for (let k = 0; k < 9; k++) blip(at(330) + k * 0.25, hz(PENTA[k]), 0.06, k % 2 ? 0.4 : -0.4, 0.3);

// étiquettes qui se rétractent (397 -> 405), montée puis aspiration
ratchet(at(397), 7, 24, 0.11, 3800, 0, 0.82);
riser(12.4, 14.0 - 12.4, 0.2);
{
  const bp = new Biquad('bp', 300, 1.3);
  span(at(405), 14.0 - at(405), (i, x, k) => {
    const u = x / (14.0 - at(405));
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
  clack(t, 1.0, 1000, 170, 0);
  clack(t + 0.004, 0.6, 2400, 300, 0.2);
  metal(t, 0.22, 247, -0.1, 2.2, 0.5);
  metal(t, 0.12, 659, 0.15, 3, 0.5);
  const lp = new Biquad('lp', 2500, 0.8);
  span(t, 0.35, (i, x) => put(i, lp.run(noise()) * Math.exp(-x * 14) * 0.5, 0, 0.3));
  pad(t, 1.0, [hz(40), hz(52), hz(55), hz(59), hz(66)], 0.07, 0.01, 0.95);
  for (const [k, m] of [64, 67, 71, 78].entries()) pluck(t + 0.05 + k * 0.06, hz(m), 0.14, (k - 1.5) * 0.25, 0.95);
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
const out = join(here, '..', '..', 'public', 'lock', 'lock.wav');
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, data);
console.log('écrit', out, (data.length / 1e6).toFixed(2), 'Mo, crête avant normalisation', peak.toFixed(3));
