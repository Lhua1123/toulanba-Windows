// Paper balls made from files, the throw, and the hoop physics (rim, board, pole, net).

import * as THREE from '../vendor/three/three.module.js';
import { HOOP, rimCenter, courtMatrix, courtInverse, courtQuat, toWorld } from './scene.js';
import { vnoise3, mulberry32, clamp, easeOutCubic, canvas } from './util.js';

const G = 9.8;
const HOLD_H = 1.15;
const RANGE = [0.5, 15];   // metres a shot travels at empty and full power
export const AIM_TOL = 0.06;                // screen angle at which the aim arrow counts as on the rim
// Help for near misses: errors shrink to HELP of themselves, by at most HELP_MAX metres — enough
// that good shots feel good, never enough that every shot goes in. JITTER is the hand's wobble.
const HELP = 0.7, HELP_MAX = 0.15;
const JITTER = { long: 0.018, side: 0.008 };
const UP = new THREE.Vector3(0, 1, 0);
const DEBUG = new URLSearchParams(location.search).has('debug');
const invQuat = courtQuat.clone().invert();

// ---------- the paper ball ----------

function collage(files, images, seed) {
  const [c, g] = canvas(1024, 512);
  const rnd = mulberry32(seed);
  g.fillStyle = '#f4f0e7'; g.fillRect(0, 0, 1024, 512);
  for (let k = 0; k < 30; k++) {
    const x = rnd() * 1024, y = rnd() * 512, w = 80 + rnd() * 160;
    g.fillStyle = 'rgba(70,72,84,0.22)';
    for (let i = 0; i < 4 + rnd() * 6; i++) g.fillRect(x, y + i * 10, w * (0.5 + rnd() * 0.5), 3);
  }
  const n = Math.max(12, files.length * 4);
  for (let k = 0; k < n; k++) {
    const f = files[k % files.length], img = f.image || images[f.type];
    if (!img) continue;
    const s = 100 + rnd() * 110, x = rnd() * 1024, y = 70 + rnd() * 372, a = (rnd() - 0.5) * 1.4;
    for (const ox of [-1024, 0, 1024]) {
      g.save(); g.translate(x + ox, y); g.rotate(a); g.drawImage(img, -s / 2, -s / 2, s, s); g.restore();
    }
  }
  g.font = '600 24px -apple-system, "PingFang SC", sans-serif';
  for (const f of files) {
    g.save(); g.translate(rnd() * 900, 60 + rnd() * 400); g.rotate((rnd() - 0.5) * 0.8);
    g.fillStyle = 'rgba(40,40,52,0.55)'; g.fillText(f.name, 0, 0); g.restore();
  }
  for (let k = 0; k < 80; k++) {
    g.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(110,98,80,0.22)';
    g.lineWidth = 1 + rnd() * 1.6;
    let x = rnd() * 1024, y = rnd() * 512;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 3; s++) { x += (rnd() - 0.5) * 220; y += (rnd() - 0.5) * 120; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function crumpledGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 5);
  const p = geo.attributes.position, v = new THREE.Vector3();
  const o = seed * 13.7;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const d = 1
      + 0.32 * (vnoise3(v.x * 2.2 + o, v.y * 2.2, v.z * 2.2) - 0.5)
      + 0.17 * (vnoise3(v.x * 4.9, v.y * 4.9 + o, v.z * 4.9) - 0.5)
      + 0.08 * (vnoise3(v.x * 10.5, v.y * 10.5, v.z * 10.5 + o) - 0.5);
    v.multiplyScalar(d);
    p.setXYZ(i, v.x * 1.04, v.y * 0.96, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- the net (verlet) ----------

class Net {
  constructor(scene) {
    this.K = 12; this.rows = 5;
    const H = HOOP;
    this.nodes = [];
    for (let i = 0; i <= this.rows; i++) {
      for (let k = 0; k < this.K; k++) {
        const a = ((k + (i % 2) * 0.5) / this.K) * Math.PI * 2;
        const rr = H.rimR * (1 - 0.42 * (i / this.rows));
        const w = toWorld(Math.cos(a) * rr, H.rimY - (i / this.rows) * H.netLen, H.rimZ + Math.sin(a) * rr);
        this.nodes.push({ p: w.clone(), q: w.clone(), rest: w.clone(), pinned: i === 0 });
      }
    }
    const id = (i, k) => i * this.K + ((k + this.K) % this.K);
    this.links = [];
    const link = (a, b) => this.links.push([a, b, this.nodes[a].p.distanceTo(this.nodes[b].p)]);
    for (let i = 0; i < this.rows; i++) for (let k = 0; k < this.K; k++) {
      link(id(i, k), id(i + 1, k));
      link(id(i, k), id(i + 1, i % 2 ? k + 1 : k - 1));
    }
    for (let k = 0; k < this.K; k++) link(id(this.rows, k), id(this.rows, k + 1));

    const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#f4f3ee', roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.links.length);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.d = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.render();
  }

  step(dt, balls) {
    const g = -G * dt * dt;
    for (const n of this.nodes) {
      if (n.pinned) continue;
      const vx = (n.p.x - n.q.x) * 0.95, vy = (n.p.y - n.q.y) * 0.95, vz = (n.p.z - n.q.z) * 0.95;
      n.q.copy(n.p);
      n.p.x += vx; n.p.y += vy + g; n.p.z += vz;
      // gentle pull back to the hanging shape keeps the net from tangling
      n.p.lerp(n.rest, 0.02);
    }
    for (let it = 0; it < 6; it++) {
      for (const [a, b, L] of this.links) {
        const A = this.nodes[a], B = this.nodes[b];
        this.d.subVectors(B.p, A.p);
        const len = this.d.length() || 1e-6;
        const diff = (len - L) / len;
        if (A.pinned) B.p.addScaledVector(this.d, -diff);
        else if (B.pinned) A.p.addScaledVector(this.d, diff);
        else { A.p.addScaledVector(this.d, diff * 0.5); B.p.addScaledVector(this.d, -diff * 0.5); }
      }
      for (const b of balls) {
        if (b.state !== 'air') continue;
        for (const n of this.nodes) {
          if (n.pinned) continue;
          this.d.subVectors(n.p, b.pos);
          const dist = this.d.length(), min = b.r * 0.92 + 0.02;
          if (dist < min && dist > 1e-5) n.p.addScaledVector(this.d, (min - dist) / dist);
        }
      }
    }
  }

  render() {
    this.links.forEach(([a, b], i) => {
      const A = this.nodes[a].p, B = this.nodes[b].p;
      this.d.subVectors(B, A);
      const len = this.d.length();
      this.q.setFromUnitVectors(UP, this.d.normalize());
      this.s.set(0.011, len, 0.011);
      this.m.compose(A, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------- balls ----------

export class BallSystem {
  constructor({ scene, camera, images, sfx, onScore, onBanked }) {
    Object.assign(this, { scene, camera, images, sfx, onScore, onBanked });
    this.balls = [];
    this.rim = rimCenter;
    // The Windows front overlay must stay icon-safe: its static net belongs to the
    // back/desktop layer, so only the browser demo gets the interactive Verlet net.
    this.net = document.body.dataset.layer === 'front' ? null : new Net(scene);
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(UP, 0);
    this.size = { w: innerWidth, h: innerHeight };
    this.seed = 1;
  }

  resize(w, h) { this.size = { w, h }; }

  rayPlane(sx, sy, h) {
    const ndc = new THREE.Vector2((sx / this.size.w) * 2 - 1, -(sy / this.size.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.plane.constant = -h;
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out) ? out : null;
  }

  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.size.w, y: (1 - p.y) / 2 * this.size.h, z: p.z };
  }

  screenRadius(b) {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const a = this.toScreen(b.pos), c = this.toScreen(b.pos.clone().addScaledVector(right, b.r));
    return Math.hypot(c.x - a.x, c.y - a.y);
  }

  spawn(files, sx, sy, id) {
    const seed = this.seed++;
    const r = Math.min(0.32, 0.24 + 0.035 * Math.cbrt(files.length));
    const mesh = new THREE.Mesh(crumpledGeometry(seed), new THREE.MeshStandardMaterial({
      map: collage(files, this.images, seed * 7919), roughness: 0.8, flatShading: true,
    }));
    mesh.castShadow = true;
    mesh.scale.setScalar(0.001);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(mesh);
    const pos = this.rayPlane(sx, sy, r) || new THREE.Vector3(0, r, 0);
    const b = {
      id, files, mesh, r, pos, vel: new THREE.Vector3(0, 2.2, 0), spin: new THREE.Vector3(3, 0, 2),
      state: 'air', born: performance.now(), grow: 0, cursor: null, still: 0, scored: false, fade: 0,
    };
    b.pos.y = r;
    this.balls.push(b);
    this.sfx.pop();
    return b;
  }

  hit(sx, sy) {
    let best = null, bestD = Infinity;
    for (const b of this.balls) {
      if (b.state === 'scored' || b.state === 'gone') continue;
      const s = this.toScreen(b.pos);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < this.screenRadius(b) + 14 && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  // ---------- in hand: hover, carry, shoot ----------

  // Pick the ball up: it floats at hand height where it lies.
  lift(b) {
    if (b.state !== 'aim' && b.state !== 'held') this.sfx.pick();
    b.state = 'aim'; b.holdT = 0; b.holdFrom = b.pos.y; b.charge = 0;
    b.vel.set(0, 0, 0);
    b.anchor = new THREE.Vector2(b.pos.x, b.pos.z);
  }

  // Carry it to another spot (mouse down on the ball and drag); letting go keeps it in hand.
  grab(b, sx, sy) {
    if (b.state !== 'aim') this.sfx.pick();
    b.state = 'held'; b.holdT = 0; b.holdFrom = b.pos.y; b.cursor = { sx, sy };
    b.vel.set(0, 0, 0);
  }
  move(b, sx, sy) { b.cursor = { sx, sy }; }
  release(b) { b.state = 'aim'; b.holdT = 1; b.holdFrom = HOLD_H; b.anchor = new THREE.Vector2(b.pos.x, b.pos.z); }

  drop(b) { b.state = 'air'; b.vel.set(0, 0, 0); b.still = 0; b.charge = 0; }

  // The right amount of power for a shot from where the ball is, on the bar's 0–1 scale.
  sweetSpot(b) {
    const d = Math.hypot(rimCenter.x - b.pos.x, rimCenter.z - b.pos.z);
    return clamp((d - RANGE[0]) / (RANGE[1] - RANGE[0]), 0.03, 0.97);
  }

  // Angle on screen between an aim direction and the line from the ball to the rim.
  aimError(b, dir) {
    const bs = this.toScreen(b.pos), rs = this.toScreen(rimCenter);
    const ax = rs.x - bs.x, ay = rs.y - bs.y;
    return Math.atan2(ax * dir.y - ay * dir.x, ax * dir.x + ay * dir.y);
  }

  // Court-angle of an on-screen aim direction, measured from the line to the rim. Pointing at
  // the rim as it appears on screen counts as dead straight (the rim floats above its spot on
  // the court, so the raw mapping would be off by the parallax).
  aimYaw(b, dir) {
    const P = b.pos, bs = this.toScreen(P), rs = this.toScreen(rimCenter);
    const to = new THREE.Vector2(rimCenter.x - P.x, rimCenter.z - P.z).normalize();
    const yawOf = (dx, dy) => {
      const A = this.rayPlane(bs.x, bs.y, P.y), B = this.rayPlane(bs.x + dx * 60, bs.y + dy * 60, P.y);
      const g = new THREE.Vector2(B.x - A.x, B.z - A.z).normalize();
      return Math.atan2(to.x * g.y - to.y * g.x, to.dot(g));
    };
    const rl = Math.hypot(rs.x - bs.x, rs.y - bs.y) || 1;
    return yawOf(dir.x, dir.y) - yawOf((rs.x - bs.x) / rl, (rs.y - bs.y) / rl);
  }

  // Launch velocity. dir: unit vector on screen (where the pointer aims); power: 0–1 from the bar,
  // which sets how far the ball flies. Nothing is guaranteed: a near miss is only pulled part of
  // the way toward the hoop, and a real throw (shake) adds a little hand wobble.
  launch(b, dir, power, shake = false) {
    const P = b.pos;
    const to = new THREE.Vector2(rimCenter.x - P.x, rimCenter.z - P.z);
    const d = Math.max(0.9, to.length());
    to.normalize();
    const pull = (e) => Math.sign(e) * Math.max(Math.abs(e) * HELP, Math.abs(e) - HELP_MAX);
    let long = RANGE[0] + power * (RANGE[1] - RANGE[0]) - d;     // metres past (+) or short of (−) the rim
    let side = this.aimYaw(b, dir) * d;                           // metres left/right of it
    long = pull(long); side = pull(side);
    if (shake) { long += (Math.random() * 2 - 1) * JITTER.long * d; side += (Math.random() * 2 - 1) * JITTER.side * d; }
    const range = Math.max(0.5, d + long), yaw = side / d;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const fx = to.x * c - to.y * s, fz = to.x * s + to.y * c;
    // Arc: peak this far above the rim, higher for longer shots, so the ball always drops in
    // steeply (~55°+) instead of skimming the front of the rim.
    const peak = rimCenter.y + 0.9 + 0.22 * range;
    const up = Math.sqrt(2 * G * Math.max(0.2, peak - P.y));
    const flight = up / G + Math.sqrt((2 * (peak - rimCenter.y)) / G);
    const across = range / flight;
    const clean = HOOP.rimR - HOOP.tube - b.r;
    return { vel: new THREE.Vector3(fx * across, up, fz * across),
      aimed: Math.hypot(long, side) < clean, long, side, d, dp: power - this.sweetSpot(b) };
  }

  shoot(b, dir, power) {
    const L = this.launch(b, dir, power, true);
    b.vel.copy(L.vel);
    b.spin.set(L.vel.x, 0, L.vel.z).normalize().cross(UP).multiplyScalar(-9);
    b.state = 'air'; b.still = 0; b.charge = 0;
    this.sfx.whoosh(Math.min(1, L.vel.length() / 12));
    if (DEBUG) console.log('shot', JSON.stringify({ d: +L.d.toFixed(2), power: +power.toFixed(3), dp: +L.dp.toFixed(3), long: +L.long.toFixed(2), side: +L.side.toFixed(2), clean: L.aimed }));
    return { aimed: L.aimed };
  }

  // Where a shot with this aim and power would fly (gravity only, same launch as shoot), and
  // whether it drops cleanly through the rim. More power, longer path.
  predict(b, dir, power) {
    const v = this.launch(b, dir, power).vel, p = b.pos.clone(), pts = [p.clone()];
    const dt = 1 / 60, clear = HOOP.rimR - HOOP.tube - b.r;
    let makes = false;
    for (let t = 0; t < 3; t += dt) {
      const prevY = p.y;
      v.y -= G * dt;
      p.addScaledVector(v, dt);
      pts.push(p.clone());
      if (prevY > rimCenter.y && p.y <= rimCenter.y && v.y < 0) {
        makes = Math.hypot(p.x - rimCenter.x, p.z - rimCenter.z) < clear;
        if (makes) break;
      }
      if (p.y < b.r) break;
    }
    return { pts, makes };
  }

  // ---------- physics ----------

  collideHoop(b) {
    const H = HOOP;
    // rim (a torus around rimCenter)
    const hx = b.pos.x - rimCenter.x, hz = b.pos.z - rimCenter.z;
    const rho = Math.hypot(hx, hz) || 1e-6;
    const q = new THREE.Vector3(rimCenter.x + (hx / rho) * H.rimR, rimCenter.y, rimCenter.z + (hz / rho) * H.rimR);
    const n = b.pos.clone().sub(q);
    const dist = n.length(), min = b.r + H.tube;
    if (dist < min) {
      n.divideScalar(dist || 1e-6);
      b.pos.copy(q).addScaledVector(n, min);
      const vn = b.vel.dot(n);
      if (vn < 0) {
        b.vel.addScaledVector(n, -(1 + 0.5) * vn);
        b.vel.multiplyScalar(0.92);
        if (-vn > 0.5) this.sfx.rim(Math.min(1, -vn / 6));
        if (DEBUG) console.log('rim', JSON.stringify({ p: b.pos.toArray().map((v) => +v.toFixed(2)), vn: +vn.toFixed(2) }));
      }
    }
    // board and pole, in the court frame
    const pl = b.pos.clone().applyMatrix4(courtInverse);
    const vl = b.vel.clone().applyQuaternion(invQuat);
    let touched = false;
    const top = H.boardBottom + H.boardH;
    if (Math.abs(pl.x) < H.boardW / 2 + b.r * 0.4 && pl.y > H.boardBottom - b.r * 0.4 && pl.y < top + b.r * 0.4
      && pl.z < H.boardZ + b.r && pl.z > H.boardZ - H.boardT - 0.3) {
      pl.z = H.boardZ + b.r;
      if (vl.z < 0) { if (-vl.z > 0.6) this.sfx.board(Math.min(1, -vl.z / 8)); vl.z = -vl.z * 0.55; vl.x *= 0.85; vl.y *= 0.85; }
      if (DEBUG) console.log('board', JSON.stringify(pl.toArray().map((v) => +v.toFixed(2))));
      touched = true;
    }
    if (pl.y < H.poleH) {
      const dx = pl.x, dz = pl.z - H.poleZ, rr = Math.hypot(dx, dz), m = H.poleR + 0.05 + b.r;
      if (rr < m) {
        const nx = dx / (rr || 1e-6), nz = dz / (rr || 1e-6);
        pl.x = nx * m; pl.z = H.poleZ + nz * m;
        const vn = vl.x * nx + vl.z * nz;
        if (vn < 0) { vl.x -= 1.5 * vn * nx; vl.z -= 1.5 * vn * nz; if (-vn > 0.6) this.sfx.board(Math.min(1, -vn / 8)); }
        touched = true;
      }
    }
    if (touched) {
      b.pos.copy(pl.applyMatrix4(courtMatrix));
      b.vel.copy(vl.applyQuaternion(courtQuat));
    }
  }

  step(b, dt) {
    if (b.state === 'aim') {
      b.holdT += dt;
      const h = b.holdFrom + (HOLD_H - b.holdFrom) * easeOutCubic(Math.min(1, b.holdT / 0.22))
        + 0.035 * Math.sin(b.holdT * 3.2) - 0.14 * b.charge;
      b.pos.lerp(new THREE.Vector3(b.anchor.x, h, b.anchor.y), 1 - Math.exp(-22 * dt));
      b.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, dt * (0.5 + 4 * b.charge)));
      return;
    }
    if (b.state === 'held') {
      b.holdT += dt;
      const h = b.holdFrom + (HOLD_H - b.holdFrom) * easeOutCubic(Math.min(1, b.holdT / 0.16));
      const target = this.rayPlane(b.cursor.sx, b.cursor.sy, h);
      if (target) {
        const before = b.pos.clone();
        b.pos.lerp(target, 1 - Math.exp(-40 * dt));
        b.vel.subVectors(b.pos, before).divideScalar(dt);
      }
      return;
    }
    if (b.state === 'rest' || b.state === 'gone') return;

    const prevY = b.pos.y;
    b.vel.y -= G * dt;
    b.pos.addScaledVector(b.vel, dt);
    this.collideHoop(b);

    // ground
    let onGround = false;
    if (b.pos.y <= b.r) {
      b.pos.y = b.r;
      onGround = true;
      if (b.vel.y < 0) {
        const impact = -b.vel.y;
        if (impact > 0.7) { b.vel.y = impact * 0.42; this.sfx.bounce(Math.min(1, impact / 7)); } else b.vel.y = 0;
        b.vel.x *= 0.8; b.vel.z *= 0.8; b.spin.multiplyScalar(0.4);
      }
      if (b.vel.y === 0) { const f = Math.exp(-1.7 * dt); b.vel.x *= f; b.vel.z *= f; }
    }

    // the screen edges are walls
    if (b.pos.y < 1.8) {
      const s = this.toScreen(b.pos), m = 6 + this.screenRadius(b);
      if (s.x < m && b.vel.x < 0) b.vel.x *= -0.5;
      if (s.x > this.size.w - m && b.vel.x > 0) b.vel.x *= -0.5;
      if (s.y > this.size.h - m && b.vel.z > 0) b.vel.z *= -0.5;
      if (s.y < 40 + m && b.vel.z < 0 && b.pos.y < 0.8) b.vel.z *= -0.5;
    }

    // through the hoop?
    if (DEBUG && prevY > rimCenter.y && b.pos.y <= rimCenter.y) console.log('cross', JSON.stringify({ off: +Math.hypot(b.pos.x - rimCenter.x, b.pos.z - rimCenter.z).toFixed(3), local: b.pos.clone().applyMatrix4(courtInverse).toArray().map((v) => +v.toFixed(2)) }));
    if (!b.scored && prevY > rimCenter.y && b.pos.y <= rimCenter.y
      && Math.hypot(b.pos.x - rimCenter.x, b.pos.z - rimCenter.z) < HOOP.rimR - b.r * 0.3) {
      b.scored = true;
      b.vel.multiplyScalar(0.55);
      this.sfx.swish();
      this.onScore?.(b);
    }
    if (b.scored && b.pos.y < rimCenter.y - HOOP.netLen * 0.75) {
      b.fade += dt / 0.32;
      if (b.fade >= 1) { b.state = 'gone'; this.scene.remove(b.mesh); this.onBanked?.(b); }
    }

    // rotation: roll on the ground, keep the throw's spin in the air
    if (onGround && b.vel.y === 0) {
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 1e-4) b.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(b.vel.z, 0, -b.vel.x).normalize(), (sp / b.r) * dt));
      if (sp < 0.05) { b.still += dt; if (b.still > 0.25) { b.state = 'rest'; b.vel.set(0, 0, 0); } } else b.still = 0;
    } else {
      const w = b.spin.length();
      if (w > 1e-4) b.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(b.spin.clone().normalize(), w * dt));
    }
  }

  update(dt) {
    const sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      for (const b of this.balls) this.step(b, h);
      this.net?.step(h, this.balls);
    }
    this.net?.render();
    const now = performance.now();
    for (const b of this.balls) {
      const age = (now - b.born) / 1000;
      const grow = age < 0.42 ? 1 + 0.18 * Math.sin((age / 0.42) * Math.PI) * (1 - age / 0.42) : 1;
      const pop = Math.min(1, age / 0.18);
      const held = b.state === 'held' || b.state === 'aim' ? 1.04 : 1;
      b.mesh.scale.setScalar(b.r * pop * grow * held * (1 - easeOutCubic(Math.min(1, b.fade))));
      b.mesh.position.copy(b.pos);
    }
    this.balls = this.balls.filter((b) => b.state !== 'gone');
  }

  // Screen circles the Mac shell uses to decide when the overlay should take the mouse.
  circles() {
    return this.balls.filter((b) => b.state !== 'gone' && !b.scored).map((b) => {
      const s = this.toScreen(b.pos);
      return { x: Math.round(s.x), y: Math.round(s.y), r: Math.round(this.screenRadius(b) + 14) };
    });
  }

  remove(b) {
    b.state = 'gone';
    this.scene.remove(b.mesh);
    this.balls = this.balls.filter((x) => x !== b);
  }
}
