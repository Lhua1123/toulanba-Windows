// Synthesised, quiet sound effects (no audio files).

let ctx, out, noise;

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    out = ctx.createGain();
    out.gain.value = 0.45;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx.currentTime;
}

function burst(t0, dur, { f = 2000, q = 1, type = 'bandpass', gain = 0.3, f2 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const flt = ctx.createBiquadFilter();
  flt.type = type; flt.frequency.setValueAtTime(f, t0); flt.Q.value = q;
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt).connect(g).connect(out);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.05);
}

function tone(t0, dur, f, gain, type = 'sine', f2) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

export const sfx = {
  unlock() { ensure(); },
  crumple(n = 3) {
    const t = ensure();
    const k = 16 + Math.min(20, n * 2);
    for (let i = 0; i < k; i++) {
      const tt = t + 0.5 * Math.pow(Math.random(), 0.7);
      burst(tt, 0.015 + Math.random() * 0.05, { f: 1500 + Math.random() * 5000, q: 0.7 + Math.random() * 2.5, gain: 0.12 + Math.random() * 0.22 });
    }
  },
  pop() { const t = ensure(); tone(t + 0.42, 0.12, 360, 0.08, 'sine', 620); },
  pick() { const t = ensure(); burst(t, 0.06, { f: 900, q: 1.2, gain: 0.08 }); },
  whoosh(p = 0.6) { const t = ensure(); burst(t, 0.32 + p * 0.15, { f: 500, f2: 1700, q: 0.9, gain: 0.07 + p * 0.1 }); },
  rim(s = 0.5) {
    const t = ensure();
    [1, 2.76, 5.4, 8.93].forEach((m, i) => tone(t, 0.5 / (i + 1) + 0.12, 560 * m, (0.11 * s) / (i + 1), 'sine'));
    burst(t, 0.04, { f: 3000, q: 2, gain: 0.08 * s });
  },
  board(s = 0.5) { const t = ensure(); burst(t, 0.13, { f: 420, type: 'lowpass', q: 0.7, gain: 0.35 * s }); tone(t, 0.16, 140, 0.18 * s); },
  swish() {
    const t = ensure();
    burst(t, 0.42, { f: 2600, type: 'highpass', q: 0.5, gain: 0.1 });
    burst(t + 0.05, 0.3, { f: 5200, type: 'bandpass', q: 0.8, gain: 0.06 });
  },
  bounce(s = 0.5) { const t = ensure(); burst(t, 0.07, { f: 700, type: 'lowpass', q: 0.8, gain: 0.25 * s }); burst(t, 0.03, { f: 3000, q: 1.5, gain: 0.05 * s }); },
  unfold() {
    const t = ensure();
    for (let i = 0; i < 10; i++) burst(t + Math.random() * 0.35, 0.03 + Math.random() * 0.05, { f: 1200 + Math.random() * 3000, q: 1, gain: 0.1 });
  },
};
