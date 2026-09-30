// The 30-second cue for the Gridspin title sequence, synthesized sample by sample.
//
// There is no sample library and no audio model here: every sound is arithmetic. Oscillators, filtered
// noise, envelopes and a delay line, summed into a stereo buffer and written out as a RIFF/WAVE file
// that ffmpeg muxes into the MP4. That constraint is also the licence - nothing in this file is
// anybody else's recording, so the film can be posted anywhere.
//
// It is written to the picture, not under it: 160 BPM, 1.5s bars, 20 bars in exactly 30.000s, and the
// five 4-bar phrases are the five cuts of the film. See tools/film/spin-an-era.html's BEATS.
//
//   node tools/film/score.mjs [--out build/film/score.wav]

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const SR = 48000;
const DUR = 30.0;
const N = Math.round(SR * DUR);
const BPM = 160;
const BEAT = 60 / BPM;          // 0.375s
const BAR = BEAT * 4;           // 1.5s
const OUT = resolve(arg("out", "build/film/score.wav"));

const L = new Float64Array(N);
const R = new Float64Array(N);

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, p) => a + (b - a) * p;
const beats = (b) => b * BEAT;
const bars = (b) => b * BAR;

// An envelope that never starts or stops at a non-zero sample. A hard gate on a waveform mid-cycle is
// a step change, and a step change is a click - the most common way synthesized music gives itself
// away. Attack is never shorter than ~1.5ms for the same reason.
function env(i, len, { a = 0.004, d = 0.08, s = 0.0, r = 0.06, sus = 0 } = {}) {
  const t = i / SR;
  const aT = Math.max(a, 0.0015);
  const total = len;
  if (t < 0 || t > total) return 0;
  const rStart = total - r;
  if (t < aT) return t / aT;                                   // linear in, click-free
  if (sus > 0 && t < rStart) {
    const dT = Math.min(d, rStart - aT);
    if (t < aT + dT) return lerp(1, s, (t - aT) / dT);
    return s;
  }
  if (t < rStart) {
    const k = (t - aT) / Math.max(d, 1e-6);
    return Math.exp(-k * 3.2);                                  // exponential decay reads as "hit"
  }
  const tail = (total - t) / Math.max(r, 1e-6);
  const at = Math.exp(-((rStart - aT) / Math.max(d, 1e-6)) * 3.2);
  return at * clamp(tail, 0, 1);
}

// PolyBLEP: a saw or square built naively is a stack of harmonics that run past Nyquist and fold back
// as inharmonic whistling, which is what makes cheap synthesis sound cheap. This rounds the corner of
// each discontinuity over one sample and removes most of it for a few lines of arithmetic.
function polyBlep(ph, dt) {
  if (ph < dt) { const x = ph / dt; return x + x - x * x - 1; }
  if (ph > 1 - dt) { const x = (ph - 1) / dt; return x * x + x + x + 1; }
  return 0;
}
function saw(ph, dt) { return 2 * ph - 1 - polyBlep(ph, dt); }
function sqr(ph, dt, pw = 0.5) {
  let v = ph < pw ? 1 : -1;
  v += polyBlep(ph, dt) * -1;
  v += polyBlep((ph + (1 - pw)) % 1, dt);
  return v;
}

// A state-variable filter: stable, cheap, and gives low/band/high from the same two integrators.
function makeSVF() {
  let lp = 0, bp = 0;
  return (x, cutoff, q) => {
    const f = 2 * Math.sin(Math.PI * Math.min(cutoff, SR * 0.45) / SR);
    const damp = 1 / Math.max(q, 0.5);
    const hp = x - lp - damp * bp;
    bp += f * hp;
    lp += f * bp;
    return { lp, bp, hp };
  };
}

let noiseState = 0x2f6e2b1 >>> 0;
function noise() {                       // xorshift, so the "randomness" is identical every render
  noiseState ^= noiseState << 13; noiseState >>>= 0;
  noiseState ^= noiseState >> 17;
  noiseState ^= noiseState << 5; noiseState >>>= 0;
  return (noiseState / 0xffffffff) * 2 - 1;
}

function add(at, dur, fn, pan = 0) {
  const start = Math.round(at * SR);
  const len = Math.round(dur * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4);   // equal-power pan
  const gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < len; i++) {
    const j = start + i;
    if (j < 0 || j >= N) continue;
    const v = fn(i, len);
    if (!Number.isFinite(v)) continue;
    L[j] += v * gl;
    R[j] += v * gr;
  }
}

// ---------------------------------------------------------------- voices
// E minor. The root is low enough to be felt on a phone's speaker as pitch rather than as a thud.
const E1 = 41.203, E2 = 82.407, G2 = 97.999, A2 = 110.0, B2 = 123.471, D3 = 146.832;
const E3 = 164.814, G3 = 195.998, B3 = 246.942, E4 = 329.628;

// Kick: a sine whose pitch falls fast from a click into the sub. The short noise transient at the top
// is what makes it audible on a laptop, where nothing below ~150Hz actually reaches the ear.
function kick(at, gain = 1) {
  add(at, 0.42, (i, len) => {
    const t = i / SR;
    const f = 52 + 118 * Math.exp(-t * 46);
    const body = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 7.5);
    const click = noise() * Math.exp(-t * 320) * 0.32;
    return (body + click) * env(i, len / SR, { a: 0.0015, d: 0.18, r: 0.06 }) * gain * 0.95;
  });
}

function sub(at, dur, hz, gain = 1) {
  const svf = makeSVF();
  add(at, dur, (i, len) => {
    const t = i / SR;
    const ph = (hz * t) % 1;
    const dt = hz / SR;
    const raw = Math.sin(2 * Math.PI * hz * t) * 0.8 + saw(ph, dt) * 0.2;
    const f = svf(raw, 180, 0.9);
    return f.lp * env(i, len / SR, { a: 0.006, d: 0.4, s: 0.85, sus: 1, r: 0.05 }) * gain * 0.55;
  });
}

// Snare/clap: three noise bursts a few ms apart read as hands rather than as one flat hiss.
function clap(at, gain = 1) {
  const svf = makeSVF();
  add(at, 0.3, (i, len) => {
    const t = i / SR;
    let amp = 0;
    for (const off of [0, 0.009, 0.018]) {
      if (t >= off) amp += Math.exp(-(t - off) * 46);
    }
    amp += Math.exp(-t * 9) * 0.7;
    const f = svf(noise(), 1900, 1.4);
    return f.bp * amp * 0.22 * gain * env(i, len / SR, { a: 0.0015, d: 0.22, r: 0.04 });
  });
}

function hat(at, dur, gain = 1, open = false) {
  const svf = makeSVF();
  add(at, dur, (i, len) => {
    const t = i / SR;
    const f = svf(noise(), 8200, 0.8);
    const decay = open ? 16 : 62;
    return f.hp * Math.exp(-t * decay) * 0.16 * gain * env(i, len / SR, { a: 0.0015, d: 0.05, r: 0.02 });
  }, 0.18);
}

// The stab: three saws detuned in cents, through a filter that opens with the note. One saw is thin;
// three beating against each other is a chord's worth of movement from one pitch.
function stab(at, dur, hz, gain = 1, pan = 0, cut = 2400) {
  const svf = makeSVF();
  const det = [-9, 0, 7];
  add(at, dur, (i, len) => {
    const t = i / SR;
    let v = 0;
    for (const c of det) {
      const f = hz * Math.pow(2, c / 1200);
      v += saw((f * t) % 1, f / SR);
    }
    v /= det.length;
    const e = env(i, len / SR, { a: 0.004, d: 0.14, r: 0.05 });
    const o = svf(v, 220 + cut * e, 1.7);
    return o.lp * e * 0.3 * gain;
  }, pan);
}

// A noise sweep that rises into a cut. The filter opening is what carries it, not the level.
function riser(at, dur, gain = 1) {
  const svf = makeSVF();
  add(at, dur, (i, len) => {
    const p = i / len;
    const f = svf(noise(), 300 + 7000 * p * p, 1.2);
    return f.bp * p * p * 0.2 * gain;
  });
}

// The impact under a hard cut: a sine dropping an octave and a half, plus a wide noise slam.
function impact(at, gain = 1) {
  add(at, 1.6, (i, len) => {
    const t = i / SR;
    const f = 150 * Math.exp(-t * 5.5) + 38;
    const body = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 3.1);
    const air = noise() * Math.exp(-t * 26) * 0.25;
    return (body + air) * gain * 0.8 * env(i, len / SR, { a: 0.002, d: 0.9, r: 0.35 });
  });
}

// A reverse swell that arrives exactly on a downbeat - the oldest trick for making a cut feel inevitable.
function reverseSwell(at, dur, gain = 1) {
  const svf = makeSVF();
  add(at - dur, dur, (i, len) => {
    const p = i / len;
    const f = svf(noise(), 900 + 5200 * p, 1.1);
    return f.bp * Math.pow(p, 2.6) * 0.22 * gain;
  });
}

// ---------------------------------------------------------------- the arrangement
// TENSION AND RELEASE. The whole cue aims at 24.000s, where the record hits.
//
// The device: for the first 24 seconds there is NO low end. The bass plays, but every voice runs
// through a bus highpass parked at 110 Hz, so the cue is bright, dry and weightless - it sounds like
// something being withheld. Four frames before the cut the music stops dead. Then at 24.000 the
// highpass opens to 25 Hz and the kick, the sub, the full chord and the room all arrive together.
// That release lands whether or not the tune is any good, which is the right bet for a cue that
// cannot be re-recorded. The alternative - a steady pulse all the way through - was tried first and
// is the thing that makes synthesized music sound like a phone ringtone: nothing is ever spent.
//
// A minor. The six draft cards each play one note of a rising figure, so six events that would be six
// disconnected stabs become one phrase that arrives somewhere.
const A2n = 110.0, C3n = 130.813, D3n = 146.832, E3n = 164.814, G3n = 195.998;
const A3n = 220.0, C4n = 261.626, D4n = 293.665, E4n = 329.628, G4n = 391.995, A4n = 440.0;
const A1n = 55.0, E2n = 82.407, F2n = 87.307;

// A bell for the motif: a triangle with a little square on top, plucked. Warmer than a bare square.
function bell(at, dur, hz, gain = 1, pan = 0) {
  add(at, dur, (i, len) => {
    const t = i / SR;
    const tri = Math.asin(Math.sin(2 * Math.PI * hz * t)) * (2 / Math.PI);
    const sq = sqr((hz * 2 * t) % 1, hz * 2 / SR) * 0.18;
    return (tri + sq) * Math.exp(-t * 4.2) * 0.3 * gain * env(i, len / SR, { a: 0.003, d: 0.5, r: 0.12 });
  }, pan);
}

const MOTIF = [A3n, C4n, D4n, E4n, G4n, A4n];

// PHRASE 1 - bars 1-4 (0-6s). THE QUESTION. Bare: the motif stated over an offbeat tick. No drums.
for (let b = 0; b < 4; b++) {
  const t0 = bars(b);
  for (let e = 0; e < 4; e++) hat(t0 + beats(e + 0.5), 0.07, 0.30);   // offbeats only - unsettled
}
bell(beats(0), 1.1, MOTIF[0], 0.85, -0.25);
bell(beats(3), 1.1, MOTIF[2], 0.75, 0.25);
bell(bars(2), 1.3, MOTIF[4], 0.8, -0.15);
bell(bars(2) + beats(3), 1.6, MOTIF[3], 0.7, 0.2);
reverseSwell(bars(4), 0.9, 0.7);

// PHRASE 2 - bars 5-8 (6-12s). THE SPIN. A pulse starts. Reel ticks decelerate over a groove that
// does not: the wheel slows, the music never does.
for (let b = 4; b < 8; b++) {
  const t0 = bars(b);
  kick(t0, 0.7);
  kick(t0 + beats(2), 0.55);
  for (let e = 0; e < 8; e++) hat(t0 + beats(e / 2), 0.07, e % 2 ? 0.26 : 0.44);
  if (b >= 6) clap(t0 + beats(2), 0.4);
}
// 23 ticks: sixteenths, then eighths, then three quarter notes into the landing at 9.75.
const TICKS = [];
for (let i = 0; i <= 14; i++) TICKS.push(6.0 + i * (BEAT / 4));
for (const q of [16, 18, 20, 22, 25, 28, 32]) TICKS.push(6.0 + q * (BEAT / 4));
TICKS.push(9.75 - BEAT * 2, 9.75 - BEAT, 9.75);
TICKS.forEach((at, i) => {
  const p = i / (TICKS.length - 1);
  add(at, 0.05, (k, len) => {
    const t = k / SR;
    return (noise() * 0.5 + Math.sin(2 * Math.PI * (2600 - 900 * p) * t)) *
      Math.exp(-t * 120) * (0.05 + 0.10 * p);
  }, 0);
});
bell(9.75, 1.4, MOTIF[1], 0.8, 0);
kick(9.75, 0.9);

// PHRASE 3 - bars 9-12 (12-18s). THE DRAFT. Six cards, six notes, rising. Bass enters - but the bus
// highpass is still at 110 Hz, so it is all attack and no weight.
for (let b = 8; b < 12; b++) {
  const t0 = bars(b);
  kick(t0, 0.8);
  kick(t0 + beats(2.5), 0.6);
  clap(t0 + beats(2), 0.5);
  for (let e = 0; e < 8; e++) hat(t0 + beats(e / 2), 0.07, e % 2 ? 0.28 : 0.5);
  sub(t0, BAR * 0.9, [A2n, A2n, G3n / 2, F2n][b - 8], 0.7);
}
for (let i = 0; i < 6; i++) {
  const at = 12.75 + i * beats(2);
  bell(at, 0.9, MOTIF[i], 0.72, i % 2 ? 0.22 : -0.22);
  stab(at, 0.3, MOTIF[i], 0.3, 0, 2400);
}
reverseSwell(bars(12), 0.7, 0.75);

// PHRASE 4 - bars 13-16 (18-24s). THE SEASON. Sixteenths; the snare roll tightens; everything climbs.
for (let b = 12; b < 16; b++) {
  const t0 = bars(b);
  kick(t0, 0.85);
  kick(t0 + beats(2.5), 0.7);
  clap(t0 + beats(1), 0.55);
  clap(t0 + beats(3), 0.55);
  for (let e = 0; e < 16; e++) hat(t0 + beats(e / 4), 0.045, e % 4 === 0 ? 0.55 : e % 2 ? 0.2 : 0.33);
  sub(t0, BAR * 0.9, [A2n, C3n, D3n, E3n][b - 12], 0.8);
}
// One tick per game, panning across the field as the row fills.
for (let i = 0; i < 17; i++) {
  add(18.75 + i * (BEAT / 4), 0.055, (k) => {
    const t = k / SR;
    return Math.sin(2 * Math.PI * (2300 + i * 95) * t) * Math.exp(-t * 95) * 0.05;
  }, lerp(-0.55, 0.55, i / 16));
}
for (let i = 0; i < 3; i++) stab(21.0 + i * BEAT, 0.3, [E4n, G4n, A4n][i], 0.42, 0, 3000);
// The roll: eighths to sixteenths to thirty-seconds, straight into the wall of silence.
let rt = 22.5;
let step = BEAT / 2;
while (rt < 23.86) {
  clap(rt, clamp(0.25 + (rt - 22.5) / 1.4, 0, 1) * 0.7);
  rt += step;
  if (rt > 23.2) step = BEAT / 4;
  if (rt > 23.6) step = BEAT / 8;
}
riser(22.0, 1.86, 1.0);

// PHRASE 5a - bars 17-18 (24-27s). THE RECORD. Out of 94ms of nothing, all of it at once.
impact(24.0, 1.0);
kick(24.0, 1.0);
clap(24.0, 0.65);
sub(24.0, 2.9, A1n, 1.0);
for (const [hz, pan, g] of [[A3n, -0.3, 0.55], [C4n, 0.3, 0.5], [E4n, 0, 0.45], [A4n, -0.15, 0.35]]) {
  stab(24.0, 1.6, hz, g, pan, 3600);
}
bell(24.0, 2.2, A4n, 0.6, 0);
kick(24 + beats(4), 0.8);
clap(24 + beats(4), 0.5);
for (let e = 0; e < 8; e++) hat(24 + beats(e / 2), 0.06, e % 2 ? 0.24 : 0.44);

// PHRASE 5b - bars 19-20 (27-30s). THE LOCKUP. Thins to an open fifth and ends on silence.
kick(27.0, 0.85);
sub(27.0, 2.5, A1n, 0.75);
stab(27.0, 1.2, A3n, 0.4, -0.2, 2400);
stab(27.0, 1.2, E4n, 0.36, 0.2, 2400);
kick(27 + beats(2), 0.55);
hat(27 + beats(1), 0.08, 0.35);
hat(27 + beats(3), 0.08, 0.3);
bell(28.5, 1.4, A4n, 0.45, 0);            // the last note, under the url
add(28.5, 1.45, (i, len) => {
  const p = i / len;
  return Math.sin(2 * Math.PI * A2n * (i / SR)) * (1 - p) * (1 - p) * 0.09;
});

// ---------------------------------------------------------------- bus
// THE DEVICE. One highpass across the whole mix, parked at 110 Hz until the record and then opened to
// 25 Hz over 120ms. Nothing else about the arrangement changes at 24.000 - the weight arriving IS the
// event. A one-pole highpass is y[n] = a*(y[n-1] + x[n] - x[n-1]); sweeping `a` sweeps the cutoff.
const OPEN_AT = 24.0, OPEN_OVER = 0.12;
let hpL = 0, hpR = 0, pxL = 0, pxR = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const cut = t < OPEN_AT ? 110 : lerp(110, 25, clamp((t - OPEN_AT) / OPEN_OVER, 0, 1));
  const a = 1 / (1 + 2 * Math.PI * cut / SR);
  hpL = a * (hpL + L[i] - pxL); pxL = L[i]; L[i] = hpL;
  hpR = a * (hpR + R[i] - pxR); pxR = R[i]; R[i] = hpR;
}

// Four frames of silence before the hit. Nothing sells a downbeat like the bar of nothing before it.
const GAP0 = Math.round((OPEN_AT - 0.094) * SR), GAP1 = Math.round(OPEN_AT * SR);
for (let i = GAP0; i < GAP1; i++) {
  const p = (i - GAP0) / (GAP1 - GAP0);
  const k = Math.max(0, 1 - p * 3);
  L[i] *= k; R[i] *= k;
}

// A short slap delay so the cue has a room rather than sitting flat against the picture.
const DLY = Math.round(beats(0.75) * SR);
for (let i = DLY; i < N; i++) {
  L[i] += R[i - DLY] * 0.13;
  R[i] += L[i - DLY] * 0.11;
}

// Soft-clip, then normalize to -1 dBFS. tanh rounds peaks instead of squaring them off, which is the
// difference between "loud" and "distorted"; normalizing afterwards means the whole cue keeps its
// dynamics rather than being pushed into a limiter.
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 0.86);
  R[i] = Math.tanh(R[i] * 0.86);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const target = Math.pow(10, -1 / 20);
const g = peak > 0 ? target / peak : 1;

// 3ms of fade at each end: the file must not begin or end on a non-zero sample.
const FADE = Math.round(SR * 0.003);
for (let i = 0; i < N; i++) {
  let k = g;
  if (i < FADE) k *= i / FADE;
  if (i > N - FADE) k *= (N - i) / FADE;
  L[i] *= k; R[i] *= k;
}

// ---------------------------------------------------------------- WAV
const bytes = Buffer.alloc(44 + N * 4);
bytes.write("RIFF", 0);
bytes.writeUInt32LE(36 + N * 4, 4);
bytes.write("WAVE", 8);
bytes.write("fmt ", 12);
bytes.writeUInt32LE(16, 16);          // PCM chunk size
bytes.writeUInt16LE(1, 20);           // format: PCM
bytes.writeUInt16LE(2, 22);           // channels
bytes.writeUInt32LE(SR, 24);
bytes.writeUInt32LE(SR * 4, 28);      // byte rate = SR * channels * bytesPerSample
bytes.writeUInt16LE(4, 32);           // block align
bytes.writeUInt16LE(16, 34);          // bits per sample
bytes.write("data", 36);
bytes.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  bytes.writeInt16LE(Math.round(clamp(L[i], -1, 1) * 32767), 44 + i * 4);
  bytes.writeInt16LE(Math.round(clamp(R[i], -1, 1) * 32767), 44 + i * 4 + 2);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);

const dbfs = (v) => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(2);
let rms = 0;
for (let i = 0; i < N; i++) rms += (L[i] * L[i] + R[i] * R[i]) / 2;
console.log(`${OUT}`);
console.log(`${DUR}s  ${SR}Hz  16-bit stereo  ${(bytes.length / 1048576).toFixed(2)} MB`);
console.log(`peak ${dbfs(peak * g)} dBFS   rms ${dbfs(Math.sqrt(rms / N))} dBFS   ${BPM} BPM, ${(DUR / BAR)} bars`);
