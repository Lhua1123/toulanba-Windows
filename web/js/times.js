// Times of day. `noon` is the original look, value for value. Switching eases over 1.5 s;
// `auto` follows the clock. Each layer (back and front) applies the same values to its own lights.

import * as THREE from '../vendor/three/three.module.js';

export const TIMES = {
  noon: {
    hemiSky: '#cfe8ff', hemiGround: '#e9c8a0', hemi: 1.25,
    sunColor: '#ffe1b2', sun: 3.3, sunDir: [17, 13, 6], env: 0.45, exposure: 1, shadow: 0.34,
    sea: { shallow: [0.47, 0.88, 0.82], mid: [0.12, 0.68, 0.76], deep: [0.04, 0.36, 0.56], under: [0.88, 0.82, 0.64],
      wet: [0.58, 0.46, 0.31], foam: [0.98, 0.98, 0.98], glint: [1.0, 0.93, 0.8], glintAmt: 0.7, bright: 1.25,
      haze: [1, 1, 1], hazeAmt: 0, pathX: 0, pathAmt: 0, bio: 0 },
    lamps: 0,
  },
  morning: {
    hemiSky: '#d4e9ff', hemiGround: '#efd7bb', hemi: 1.0,
    sunColor: '#ffdcbc', sun: 3.5, sunDir: [-14, 5.5, -5], env: 0.5, exposure: 1.02, shadow: 0.3,
    sea: { shallow: [0.62, 0.92, 0.88], mid: [0.3, 0.74, 0.82], deep: [0.18, 0.5, 0.7], under: [0.9, 0.86, 0.72],
      wet: [0.6, 0.52, 0.4], foam: [1, 1, 1], glint: [1, 0.97, 0.9], glintAmt: 0.5, bright: 1.2,
      haze: [0.95, 0.9, 0.9], hazeAmt: 0.28, pathX: -14, pathAmt: 0.35, bio: 0 },
    lamps: 0,
  },
  dusk: {
    hemiSky: '#ffb98f', hemiGround: '#a77a68', hemi: 0.75,
    sunColor: '#ff9a52', sun: 3.5, sunDir: [16, 7.5, 2], env: 0.35, exposure: 1, shadow: 0.45,
    sea: { shallow: [0.95, 0.7, 0.55], mid: [0.62, 0.5, 0.6], deep: [0.28, 0.3, 0.5], under: [0.9, 0.72, 0.55],
      wet: [0.5, 0.36, 0.3], foam: [1, 0.9, 0.8], glint: [1, 0.78, 0.45], glintAmt: 1.4, bright: 1.1,
      haze: [1, 0.72, 0.55], hazeAmt: 0.35, pathX: 12, pathAmt: 1, bio: 0 },
    lamps: 0,
  },
  night: {
    hemiSky: '#4a62a0', hemiGround: '#1b2230', hemi: 0.7,
    sunColor: '#a9c4ff', sun: 0.8, sunDir: [-9, 13, -8], env: 0.15, exposure: 1.1, shadow: 0.3,
    sea: { shallow: [0.1, 0.22, 0.32], mid: [0.06, 0.14, 0.27], deep: [0.03, 0.07, 0.17], under: [0.22, 0.24, 0.28],
      wet: [0.12, 0.12, 0.15], foam: [0.7, 0.8, 0.9], glint: [0.8, 0.88, 1], glintAmt: 0.9, bright: 1,
      haze: [0.1, 0.14, 0.24], hazeAmt: 0.3, pathX: -6, pathAmt: 0.6, bio: 1 },
    lamps: 1,
  },
};

// the preset for a clock time
export function timeFor(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5 && h < 9) return 'morning';
  if (h >= 9 && h < 17) return 'noon';
  if (h >= 17 && h < 19.5) return 'dusk';
  return 'night';
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerpArr = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const hex = (c) => new THREE.Color(c);

function blend(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (typeof x === 'number') out[k] = lerp(x, y, t);
    else if (Array.isArray(x)) out[k] = lerpArr(x, y, t);
    else if (typeof x === 'string') out[k] = '#' + hex(x).lerp(hex(y), t).getHexString();
    else out[k] = blend(x, y, t);
  }
  return out;
}

// rigs: [{ hemi, sun, scene, sea?, lamps?, catcher? }]; renderers: whichever layers exist.
export class Daylight {
  constructor(rigs, renderers) {
    this.rigs = rigs;
    this.renderers = renderers;
    this.mode = 'noon';
    this.from = this.to = this.now = TIMES.noon;
    this.t = 1;
    this.apply(this.now);
  }

  set(mode, instant = false) {
    this.mode = (TIMES[mode] || mode === 'auto') ? mode : 'noon';
    const name = this.mode === 'auto' ? timeFor() : this.mode;
    this.go(name, instant);
  }

  go(name, instant) {
    if (this.name === name && !instant) return;
    this.name = name;
    this.from = this.now;
    this.to = TIMES[name];
    this.t = instant ? 1 : 0;
    if (instant) { this.now = this.to; this.apply(this.now); }
  }

  // true while easing between times
  tick(dt) {
    if (this.mode === 'auto' && (this.checked = (this.checked || 0) + dt) > 30) { this.checked = 0; this.go(timeFor(), false); }
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / 1.5);
    const e = this.t * this.t * (3 - 2 * this.t);
    this.now = blend(this.from, this.to, e);
    this.apply(this.now);
    return true;
  }

  apply(p) {
    for (const r of this.rigs) {
      r.hemi.color.set(p.hemiSky); r.hemi.groundColor.set(p.hemiGround); r.hemi.intensity = p.hemi;
      r.sun.color.set(p.sunColor); r.sun.intensity = p.sun;
      // far away along the sun's direction, so nothing in the scene is behind it (shadows depend only on direction)
      r.sun.position.set(...p.sunDir).normalize().multiplyScalar(40).add(r.sun.target.position);
      r.scene.environmentIntensity = p.env;
      if (r.catcher) r.catcher.material.opacity = p.shadow;
      if (r.sea) {
        const u = r.sea.uniforms, key = (k) => 'u' + k[0].toUpperCase() + k.slice(1);   // shallow → uShallow
        for (const k of ['shallow', 'mid', 'deep', 'under', 'wet', 'foam', 'glint', 'haze']) u[key(k)].value.set(...p.sea[k]);
        for (const k of ['glintAmt', 'bright', 'hazeAmt', 'pathX', 'pathAmt', 'bio']) u[key(k)].value = p.sea[k];
      }
      r.lamps?.(p.lamps);
    }
    for (const rd of this.renderers) rd.toneMappingExposure = p.exposure;
  }
}
