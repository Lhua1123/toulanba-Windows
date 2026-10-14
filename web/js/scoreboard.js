// The scoreboard: a soft, toy-like beach gadget on two posts in the sand — cream plastic body with
// fat rounded edges and a coral bumper, a dark glass screen with glowing round-dot digits, a little
// solar panel and antenna on top. Made / attempts on the left, hit rate on the right. Digits light
// up row by row when they change; the screen flashes and a few sparkles pop on a make.

import * as THREE from '../vendor/three/three.module.js';
import { canvas } from './util.js';

export const LOOK = 'cozy gadget';   // shows in the app log, to tell which version is running

const BW = 3.0, BH = 1.5, BD = 0.18, LIFT = 0.95;       // body, and its height above the sand (m)
const SW = BW - 0.42, SH = 0.98;                          // screen
const C = {
  body: '#f3ebdc', bumper: '#ff8f6e', post: '#2f8a87', sand: '#dcc08f', glass: '#0f1d1d',
  mint: '#8ff7d4', coral: '#ff9c7a', label: '#9fe9d2', led: '#7dff9a', panel: '#1d3557',
};
const YUAN = '"Yuanti SC", "PingFang SC", sans-serif';

// 5×7 dot glyphs
const GLYPHS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// A flat piece with fat rounded edges, centred on z = 0; its front face sits at depth/2 + bevel.
function soft(w, h, r, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * bevel, h - 2 * bevel, Math.max(0.01, r - bevel)),
    { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 6, curveSegments: 14 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

function texture(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// The screen: labels, a divider, and two runs of round-dot digits. `reveal` (0–1 per group) lights
// rows top to bottom; `flash` brightens everything for a moment.
const SCR_W = 1400, SCR_H = Math.round(SCR_W * SH / SW);
function drawScreen(g, texts, reveal, flash) {
  g.fillStyle = C.glass; g.fillRect(0, 0, SCR_W, SCR_H);
  const vg = g.createRadialGradient(SCR_W / 2, SCR_H / 2, 100, SCR_W / 2, SCR_H / 2, SCR_W * 0.7);
  vg.addColorStop(0, 'rgba(60,120,110,0.18)'); vg.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = vg; g.fillRect(0, 0, SCR_W, SCR_H);
  // faint scanlines
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < SCR_H; y += 6) g.fillRect(0, y, SCR_W, 2);

  const half = SCR_W / 2;
  g.font = `700 66px ${YUAN}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillStyle = C.label; g.globalAlpha = 0.85; g.fillText('命中', 64, 82);
  g.fillStyle = C.coral; g.fillText('命中率', half + 64, 82);
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(143,247,212,0.18)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(half, 40); g.lineTo(half, SCR_H - 40); g.stroke();

  texts.forEach((text, i) => {
    const color = i ? C.coral : C.mint;
    const chars = [...text];
    const pitch = Math.min(27, (half * 0.86) / (chars.length * 6 - 1));
    const w = (chars.length * 6 - 1) * pitch;
    const x0 = i * half + (half - w) / 2, y0 = 160 + (SCR_H - 200 - 7 * pitch) / 2;
    chars.forEach((ch, k) => {
      const rows = GLYPHS[ch] || GLYPHS['-'];
      for (let r = 0; r < 7; r++) {
        const lit = r / 7 < reveal[i];
        for (let c = 0; c < 5; c++) {
          const on = rows[r][c] === '1' && lit;
          const cx = x0 + (k * 6 + c) * pitch + pitch / 2, cy = y0 + r * pitch + pitch / 2;
          g.beginPath(); g.arc(cx, cy, pitch * 0.38, 0, Math.PI * 2);
          if (on) {
            g.fillStyle = flash > 0 ? mix(color, '#ffffff', flash * 0.7) : color;
            g.shadowColor = color; g.shadowBlur = pitch * 0.9;
          } else {
            g.fillStyle = 'rgba(143,247,212,0.07)'; g.shadowBlur = 0;
          }
          g.fill();
        }
      }
      g.shadowBlur = 0;
    });
  });
}

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

// A soft highlight across the glass.
function glassSheen() {
  const [c, g] = canvas(512, 256);
  const gr = g.createLinearGradient(0, 0, 512, 256);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.32, 'rgba(255,255,255,0.0)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.12)'); gr.addColorStop(0.52, 'rgba(255,255,255,0.0)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  return texture(c);
}

// The bumper's print: a status light ring, the engraved name, a speaker grille.
function bumperFace(w, h) {
  const [c, g] = canvas(1200, Math.round(1200 * h / w));
  const H = c.height;
  g.fillStyle = 'rgba(120,40,20,0.35)';
  for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(1040 + k * 14, H / 2 - 14 + r * 14, 4, 0, Math.PI * 2); g.fill(); }
  g.font = `700 ${H * 0.4}px ${YUAN}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,240,228,0.85)'; g.fillText('海边球场', 600, H / 2 + 2);
  return texture(c);
}

function solarTexture() {
  const [c, g] = canvas(256, 128);
  g.fillStyle = C.panel; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(160,190,230,0.45)'; g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  for (let y = 0; y <= 128; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  return texture(c);
}

function sparkleTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#e4fff5';
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, r = i % 2 ? 7 : 30; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
  g.closePath(); g.fill();
  return texture(c);
}

export function buildScoreboard({ ghost = false } = {}) {
  const grp = new THREE.Group();
  const q = new URLSearchParams(location.search).get('sb')?.split(',').map(Number);
  const [x, z, ry] = q?.length === 3 ? q : [6.8, -5.5, -0.04];   // world: on the sand right of the court, facing you
  grp.position.set(x, 0, z);
  grp.rotation.y = ry;

  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o });
  const add = (geo, m, px, py, pz, parent = grp) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(px, py, pz); parent.add(mesh); return mesh; };
  const cy = LIFT + BH / 2;

  // posts with ball caps, in sand mounds
  const postH = LIFT + BH * 0.55;
  for (const px of [-BW / 2 + 0.42, BW / 2 - 0.42]) {
    add(new THREE.CylinderGeometry(0.08, 0.09, postH, 24), mat(C.post, { roughness: 0.4, metalness: 0.2 }), px, postH / 2, -0.16);
    add(new THREE.SphereGeometry(1, 24, 12), mat(C.sand, { roughness: 1 }), px, -0.02, -0.16).scale.set(0.3, 0.13, 0.26);
  }

  // body, coral bumper, screen
  const body = add(soft(BW, BH, 0.34, BD, 0.1), mat(C.body), 0, cy, 0);
  const front = BD / 2 + 0.1;
  // the coral bumper stands proud of the body's front
  const bh = 0.3, bumperZ = front - 0.11 + 0.035, bumperFront = bumperZ + 0.11, bumperY = cy - BH / 2 + bh / 2 + 0.04;
  add(soft(BW - 0.06, bh, 0.15, 0.08, 0.07), mat(C.bumper, { roughness: 0.5 }), 0, bumperY, bumperZ);
  add(new THREE.PlaneGeometry(BW - 0.5, bh - 0.06), new THREE.MeshBasicMaterial({ map: bumperFace(BW - 0.5, bh - 0.06), transparent: true, toneMapped: false }),
    0, bumperY, bumperFront + 0.003);
  const led = add(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: C.led, toneMapped: false }),
    -BW / 2 + 0.36, bumperY, bumperFront + 0.01);

  const scrY = cy + 0.13;
  add(soft(SW + 0.08, SH + 0.08, 0.16, 0.02, 0.03), mat('#2a3434', { roughness: 0.4 }), 0, scrY, front);
  const [sc, sg] = canvas(SCR_W, SCR_H);
  const scrTex = texture(sc);
  const screen = add(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }), 0, scrY, front + 0.045);
  add(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ map: glassSheen(), transparent: true, depthWrite: false, toneMapped: false }),
    0, scrY, front + 0.05);

  // solar panel and antenna on top
  const solar = new THREE.Group();
  solar.position.set(BW * 0.18, cy + BH / 2 + 0.06, -0.02);
  solar.rotation.x = 0.55;   // tipped toward you and the sky
  grp.add(solar);
  add(new THREE.BoxGeometry(1.1, 0.04, 0.5), [mat('#9aa6b2'), mat('#9aa6b2'), new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.25, metalness: 0.3 }),
    mat('#9aa6b2'), mat('#9aa6b2'), mat('#9aa6b2')], 0, 0.06, 0, solar);
  for (const sx of [-0.35, 0.35]) add(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 10), mat('#9aa6b2'), sx, -0.02, 0, solar);
  add(new THREE.CylinderGeometry(0.014, 0.018, 0.55, 10), mat('#9aa6b2', { metalness: 0.5 }), -BW * 0.33, cy + BH / 2 + 0.25, -0.03);
  add(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: C.coral, toneMapped: false }), -BW * 0.33, cy + BH / 2 + 0.54, -0.03);

  const sparkTex = sparkleTexture();
  const sparks = [];

  grp.traverse((o) => { if (o.isMesh) { o.castShadow = ghost; o.receiveShadow = false; } });
  if (ghost) {
    const none = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    grp.traverse((o) => { if (o.isMesh) o.material = none; });
  }
  body.castShadow = ghost; led.castShadow = false;

  // what the screen shows, and its animation state
  const st = { texts: ['', ''], reveal: [1, 1], flash: 0, made: -1 };
  const redraw = () => { drawScreen(sg, st.texts, st.reveal, st.flash); scrTex.needsUpdate = true; };

  function show(made, attempts, animate) {
    const rate = attempts ? String(Math.round((made / attempts) * 100)) : '--';
    const texts = [`${made}/${attempts}`, `${rate}%`];
    texts.forEach((t, i) => { if (st.texts[i] !== t) { st.texts[i] = t; if (animate) st.reveal[i] = 0; } });
    if (animate && made > st.made && st.made >= 0) { st.flash = 1; burst(); }
    st.made = made;
    redraw();
  }

  function burst() {
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false, toneMapped: false }));
      const a = Math.PI / 2 + (i / 7 - 0.5) * 2.4;
      s.position.set(-SW / 4, scrY + 0.2, front + 0.1);
      s.userData = { v: new THREE.Vector3(Math.cos(a) * 1.3, Math.sin(a) * 1.0 + 0.4, 0.25), t: 0, spin: (Math.random() - 0.5) * 6 };
      grp.add(s);
      sparks.push(s);
    }
  }

  // redraw once the rounded Chinese font is surely loaded
  document.fonts?.load(`700 40px ${YUAN}`).then(redraw).catch(() => {});

  return {
    group: grp,
    set(made, attempts, animate = true) { if (!ghost) show(made, attempts, animate); },
    // rows light up top to bottom; the flash fades; sparkles drift and fade. True while anything moves.
    tick(dt) {
      let moving = false;
      st.reveal = st.reveal.map((r) => { if (r < 1) { moving = true; return Math.min(1, r + dt / 0.38); } return r; });
      if (st.flash > 0) { st.flash = Math.max(0, st.flash - dt / 0.6); moving = true; }
      if (moving) redraw();
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i], u = s.userData;
        u.t += dt / 0.9;
        s.position.addScaledVector(u.v, dt);
        u.v.y -= 0.9 * dt;
        s.material.rotation += u.spin * dt;
        const size = 0.22 * Math.sin(Math.min(1, u.t) * Math.PI) + 0.04;
        s.scale.set(size, size, 1);
        s.material.opacity = 1 - Math.max(0, u.t - 0.6) / 0.4;
        if (u.t >= 1) { grp.remove(s); s.material.dispose(); sparks.splice(i, 1); }
        moving = true;
      }
      return moving;
    },
  };
}
