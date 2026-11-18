// Generates demo/demo.wav: a synthetic "gig" for testing transitions.
// Usage: node tools/make-demo-track.js
//
// Timeline (what the visualizer should do):
//   0-8 s    silence            -> idle ambient visuals
//   8-38 s   song 1, 120 bpm    -> swells to full intensity over ~2 s
//     22.0-23.2 s  full stop    -> must NOT flip to silent (shorter than stop hold)
//     27-31 s      quiet pad    -> quiet passage, must stay "playing"
//   38-47 s  silence            -> eases back to idle (~2.5 s hold + ~4 s ramp)
//   47-72 s  song 2, 140 bpm, louder
//   72-82 s  silence
const fs = require('fs');
const path = require('path');

const SR = 32000;
const DUR = 82;
const N = SR * DUR;
const out = new Float32Array(N);
let seed = 1;
const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };

function addSong(t0, t1, bpm, gain, breakAt = null, quiet = null) {
  const beat = 60 / bpm;
  const roots = [55, 55 * 1.189, 55 * 0.891, 55 * 1.335]; // A, C, G, D-ish
  let hpPrev = 0, hpOut = 0;
  for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) {
    const t = i / SR, lt = t - t0;
    if (breakAt && t >= breakAt[0] && t < breakAt[1]) continue;
    const inQuiet = quiet && t >= quiet[0] && t < quiet[1];
    const beatPos = lt / beat, bInBar = beatPos % 4, bar = Math.floor(beatPos / 4);
    const tb = (beatPos % 1) * beat;               // time since last beat
    const t8 = ((beatPos * 2) % 1) * beat / 2;     // since last 8th
    const t16 = ((beatPos * 4) % 1) * beat / 4;    // since last 16th
    const root = roots[bar % 4];
    let s = 0;
    // pad (always, quieter in breakdown)
    const padEnv = Math.min(1, lt / 2) * Math.min(1, (t1 - t) / 1);
    for (const m of [2, 2.52, 3]) s += Math.sin(2 * Math.PI * root * m * 2 * t) * 0.05 * padEnv;
    if (!inQuiet) {
      // kick on every beat
      const kf = 45 + 80 * Math.exp(-tb * 30);
      s += Math.sin(2 * Math.PI * kf * tb) * Math.exp(-tb * 9) * 0.9;
      // bass on 8ths
      let b = 0;
      for (let h = 1; h <= 5; h++) b += Math.sin(2 * Math.PI * root * h * t) / h;
      s += b * Math.exp(-t8 * 6) * 0.22;
      // snare on 2 and 4
      if (Math.floor(bInBar) % 2 === 1) s += (noise() * 0.5 + Math.sin(2 * Math.PI * 190 * tb) * 0.3) * Math.exp(-tb * 18) * 0.6;
      // hats on 16ths (high-passed noise)
      const n = noise();
      hpOut = 0.6 * (hpOut + n - hpPrev); hpPrev = n;
      s += hpOut * Math.exp(-t16 * 60) * 0.25;
    }
    out[i] += s * gain * (inQuiet ? 0.6 : 1);
  }
}

addSong(8, 38, 120, 0.55, [22.0, 23.2], [27, 31]);
addSong(47, 72, 140, 0.8);
for (let i = 0; i < N; i++) out[i] += noise() * 0.00005; // tiny noise floor, like a real interface

// write 16-bit mono WAV
const buf = Buffer.alloc(44 + N * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(Math.tanh(out[i]) * 32767))), 44 + i * 2);
const dir = path.join(__dirname, '..', 'demo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'demo.wav'), buf);
console.log(`Wrote demo/demo.wav (${DUR}s, ${(buf.length / 1e6).toFixed(1)} MB)`);
