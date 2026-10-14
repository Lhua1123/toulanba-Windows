// A ball in hand: the pointer aims (no click needed), holding Space charges the bar and grows
// a dotted arc up to the top of the throw, letting go of Space shoots. Where it lands is yours to
// judge: the bar has a scale and marks where you let go last time. ←/→ nudge the aim,
// Esc cancels a charge or puts the ball down.

import * as THREE from '../vendor/three/three.module.js';
import { AIM_TOL } from './ball.js';

const PASS_SECONDS = 1.6;   // the bar fills in this long, then drains and fills again
const ARROW = 112;
const BEADS = 80, BEAD_GAP = 0.3;   // dots along the arc, metres apart

export class Aim {
  constructor({ balls, scene, root, sfx, onShot, onEnd }) {
    Object.assign(this, { balls, sfx, onShot, onEnd });
    this.b = null;
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.92, depthWrite: false }), BEADS);
    this.beads.count = 0;
    this.beads.frustumCulled = false;
    this.beads.renderOrder = 2;
    scene.add(this.beads);
    this.m = new THREE.Matrix4();
    root.insertAdjacentHTML('beforeend', `
      <svg id="aim" xmlns="http://www.w3.org/2000/svg"><path class="shaft"/><path class="head"/></svg>
      <div id="power"><div class="track"><div class="fill"></div></div><div class="last"></div></div>`);
    this.svg = root.querySelector('#aim');
    this.shaft = this.svg.querySelector('.shaft');
    this.head = this.svg.querySelector('.head');
    this.bar = root.querySelector('#power');
    this.fill = this.bar.querySelector('.fill');
    this.lastMark = this.bar.querySelector('.last');
    this.last = null;   // { b, p, made } — the previous throw, marked on the bar
  }

  get active() { return !!this.b; }
  get charging() { return this.t0 != null; }

  start(b, cursor) {
    if (this.b && this.b !== b) this.end(true);
    this.b = b;
    this.cursor = cursor || null;
    this.nudge = 0;
    this.t0 = null;
    if (b.state !== 'held') this.balls.lift(b);
    this.show(true);
  }

  end(drop = true) {
    const b = this.b;
    if (!b) return;
    this.b = null; this.t0 = null;
    this.show(false);
    if (drop && (b.state === 'aim' || b.state === 'held')) this.balls.drop(b);
    this.onEnd?.(b);
  }

  point(x, y) { this.cursor = { x, y }; this.nudge = 0; }
  turn(rad) { this.nudge += rad; }

  press() {
    if (!this.b || this.charging || this.b.state !== 'aim') return;
    this.t0 = performance.now();
    this.p = 0; this.way = 1; this.inBand = false;
  }

  // Space let go: shoot with whatever the bar shows.
  letGo() {
    if (!this.charging) return;
    const b = this.b, p = this.power(), dir = this.dir();
    this.last = { b, p, made: false };
    this.b = null; this.t0 = null;
    this.show(false);
    const res = this.balls.shoot(b, dir, p);
    this.onShot?.(b, res);
  }

  // Esc while charging: no throw, the ball stays in hand
  cancelCharge() { this.t0 = null; this.p = 0; if (this.b) this.b.charge = 0; }

  // What the bar shows right now — the shot uses exactly this.
  power() { return this.charging ? this.p : 0; }

  // Fill and drain at a steady pace.
  advance(dt) {
    if (!this.charging) return;
    this.p += this.way * (dt / PASS_SECONDS);
    if (this.p >= 1) { this.p = 1; this.way = -1; }
    if (this.p <= 0) { this.p = 0; this.way = 1; }
  }

  // The last throw went in (or not): its mark on the bar turns green.
  result(b, made) { if (this.last?.b === b) this.last.made = made; }

  // Unit vector on screen: from the ball toward the pointer, or at the rim if the pointer is on the ball.
  dir() {
    const s = this.balls.toScreen(this.b.pos);
    let vx = 0, vy = 0;
    if (this.cursor) { vx = this.cursor.x - s.x; vy = this.cursor.y - s.y; }
    if (Math.hypot(vx, vy) < this.balls.screenRadius(this.b) + 24) {
      const r = this.balls.toScreen(this.balls.rim);
      vx = r.x - s.x; vy = r.y - s.y;
    }
    const a = Math.atan2(vy, vx) + this.nudge;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  show(on) {
    this.svg.style.display = on ? 'block' : 'none';
    this.bar.style.display = on ? 'block' : 'none';
    if (!on) this.beads.count = 0;
  }

  // Dots every BEAD_GAP metres along the throw, up to its highest point only: more power, a longer
  // and higher arc, but where it comes down is for you to judge.
  drawArc(b, dir, p) {
    const { pts } = this.balls.predict(b, dir, p);
    let top = 1;
    while (top < pts.length - 1 && pts[top + 1].y > pts[top].y) top++;
    const placed = [];
    let along = 0, next = b.r + 0.25;
    for (let i = 1; i <= top && placed.length < BEADS; i++) {
      along += pts[i].distanceTo(pts[i - 1]);
      if (along >= next) { placed.push(pts[i]); next += BEAD_GAP; }
    }
    placed.forEach((q, i) => {
      const k = 1 - (i / Math.max(1, placed.length)) * 0.55;
      this.m.makeScale(0.075 * k, 0.075 * k, 0.075 * k).setPosition(q);
      this.beads.setMatrixAt(i, this.m);
    });
    this.beads.count = placed.length;
    this.beads.instanceMatrix.needsUpdate = true;
  }

  update(dt = 1 / 60) {
    const b = this.b;
    if (!b) return;
    this.advance(dt);
    const p = this.power();
    b.charge = p;
    const s = this.balls.toScreen(b.pos), rp = this.balls.screenRadius(b), d = this.dir();
    const onLine = Math.abs(this.balls.aimError(b, d)) < AIM_TOL;

    const x0 = s.x + d.x * (rp + 10), y0 = s.y + d.y * (rp + 10);
    const x1 = s.x + d.x * (rp + 10 + ARROW), y1 = s.y + d.y * (rp + 10 + ARROW);
    const nx = -d.y, ny = d.x;
    this.shaft.setAttribute('d', `M${x0},${y0} L${x1 - d.x * 10},${y1 - d.y * 10}`);
    this.head.setAttribute('d', `M${x1},${y1} L${x1 - d.x * 14 + nx * 7},${y1 - d.y * 14 + ny * 7} L${x1 - d.x * 14 - nx * 7},${y1 - d.y * 14 - ny * 7}Z`);
    this.svg.classList.toggle('on', onLine);
    // while charging the arc replaces the flat arrow
    this.svg.style.display = this.charging ? 'none' : 'block';
    if (this.charging) this.drawArc(b, d, p); else this.beads.count = 0;

    const right = s.x + rp + 34 < innerWidth - 20;
    Object.assign(this.bar.style, { left: `${right ? s.x + rp + 22 : s.x - rp - 34}px`, top: `${s.y - 56}px` });
    this.fill.style.height = `${p * 100}%`;
    this.lastMark.style.display = this.last ? 'block' : 'none';
    if (this.last) {
      this.lastMark.style.bottom = `calc(${this.last.p * 100}% - 1px)`;
      this.lastMark.classList.toggle('made', this.last.made);
    }
  }
}
