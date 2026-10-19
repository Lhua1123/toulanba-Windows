// The beach court. Two scenes share one camera:
//   back  — sand, sea, court, palms (drawn under the desktop icons, like a wallpaper)
//   front — hoop, net and paper balls (drawn over the icons, click-through except the ball)
// Units are metres, Y up. The court has its own frame: baseline at z=0, court toward +z.

import * as THREE from '../vendor/three/three.module.js';
import { mulberry32, fbm2, canvas } from './util.js';
import { buildScoreboard, LOOK } from './scoreboard.js';
import { Daylight } from './times.js';
export { LOOK };

export const CFG = {
  courtYaw: 0.40,
  courtOrigin: new THREE.Vector3(-4.6, 0, -8.6),
  shoreZ: -12.5,
  sunDir: new THREE.Vector3(17, 13, 6),
  hfov: 44,
  cam: new THREE.Vector3(1, 17, 15),
  look: new THREE.Vector3(0.5, 0, -4.5),
};

// ?cam=x,y,z&look=x,y,z&hfov=44&origin=x,z&yaw=0.4&shore=-13 — tuning overrides
{
  const q = new URLSearchParams(location.search), v = (k) => q.get(k)?.split(',').map(Number);
  if (v('cam')) CFG.cam.set(...v('cam'));
  if (v('look')) CFG.look.set(...v('look'));
  if (v('hfov')) CFG.hfov = v('hfov')[0];
  if (v('origin')) CFG.courtOrigin.set(v('origin')[0], 0, v('origin')[1]);
  if (v('yaw')) CFG.courtYaw = v('yaw')[0];
  if (v('shore')) CFG.shoreZ = v('shore')[0];
}

// Hoop and ball are drawn ~2x real size so they read at desktop scale.
export const HOOP = {
  rimY: 3.2, rimR: 0.56, tube: 0.036,
  boardZ: 1.15, rimZ: 1.15 + 0.74,
  boardW: 3.0, boardH: 1.75, boardBottom: 2.95, boardT: 0.08,
  poleZ: -0.9, poleR: 0.11, poleH: 4.3,
  netLen: 0.8,
};

const COL = {
  court: '#c66a43', arc: '#d07b52', key: '#2f8a87', border: '#2c7a80',
  line: '#f3ead6', slab: '#2a6e73',
  pole: '#2a6670', pad: '#ef6a3e', board: '#f6f5f0', rim: '#ff6a1a', net: '#f4f3ee',
};

export const courtQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), CFG.courtYaw);
export const courtMatrix = new THREE.Matrix4().compose(CFG.courtOrigin, courtQuat, new THREE.Vector3(1, 1, 1));
export const courtInverse = courtMatrix.clone().invert();
export const toWorld = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(courtMatrix);
export const rimCenter = toWorld(0, HOOP.rimY, HOOP.rimZ);

export function shoreZ(x) {
  return CFG.shoreZ + 1.1 * Math.sin(x * 0.17 + 0.6) + 0.45 * Math.sin(x * 0.41 + 2.0);
}

export function makeCamera(aspect) {
  const cam = new THREE.PerspectiveCamera(30, aspect, 0.5, 260);
  cam.position.copy(CFG.cam);
  cam.lookAt(CFG.look);
  fitCamera(cam, aspect);
  return cam;
}

// Keep the horizontal field of view fixed so narrow windows still show the hoop.
export function fitCamera(cam, aspect) {
  const h = Math.tan(THREE.MathUtils.degToRad(CFG.hfov / 2));
  cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / aspect));
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
}

export function addLights(scene, mapSize = 4096) {
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0xe9c8a0, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe1b2, 3.3);
  sun.position.copy(CFG.sunDir).add(new THREE.Vector3(0, 0, -2));
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 28, bottom: -28, near: 1, far: 110 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  return { hemi, sun };
}

// Two court floodlights for the night: poles with lamp heads (only shown when lit) and spotlights.
// `poles` draws the fixtures (back layer); the front layer only needs the light.
const LAMPS = [{ at: [-9.6, -9.4], shadow: true }, { at: [12.2, -11.2], shadow: false }];   // beside the hoop; top right
const LAMP_TARGET = new THREE.Vector3(0.5, 0, -3.5), LAMP_H = 7.6, LAMP_POWER = 520;
function floodlights(scene, { poles }) {
  const parts = LAMPS.map(({ at, shadow }) => {
    const pos = new THREE.Vector3(at[0], LAMP_H, at[1]);
    const spot = new THREE.SpotLight('#ffd9a8', 0, 0, 0.62, 0.75, 2);
    spot.position.copy(pos);
    spot.target.position.copy(LAMP_TARGET);
    if (poles && shadow) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0006;
      spot.shadow.normalBias = 0.03;
    }
    scene.add(spot, spot.target);
    let fixture = null;
    if (poles) {
      fixture = new THREE.Group();
      const steel = new THREE.MeshStandardMaterial({ color: '#4c5762', roughness: 0.5, metalness: 0.4 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, LAMP_H, 14), steel);
      pole.position.set(at[0], LAMP_H / 2, at[1]);
      pole.castShadow = true;
      const head = new THREE.Group();
      head.position.copy(pos);
      head.lookAt(LAMP_TARGET);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.36, 0.3), steel);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.26), new THREE.MeshBasicMaterial({ color: '#fff4d6', toneMapped: false }));
      face.position.z = 0.16;
      head.add(box, face);
      const [gc, gg] = canvas(128, 128);
      const rg = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
      rg.addColorStop(0, 'rgba(255,236,200,0.9)'); rg.addColorStop(0.35, 'rgba(255,220,170,0.25)'); rg.addColorStop(1, 'rgba(255,220,170,0)');
      gg.fillStyle = rg; gg.fillRect(0, 0, 128, 128);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.scale.set(3, 3, 1);
      glow.position.set(0, 0, 0.35);
      head.add(glow);
      fixture.add(pole, head);
      fixture.userData.glow = glow;
      scene.add(fixture);
    }
    return { spot, fixture };
  });
  return (on) => {
    for (const { spot, fixture } of parts) {
      spot.intensity = LAMP_POWER * on;
      spot.visible = on > 0.001;
      if (fixture) { fixture.visible = on > 0.02; fixture.userData.glow.material.opacity = on; }
    }
  };
}

function skyEnvironment(renderer) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const colors = [];
  const top = new THREE.Color('#9fd3ff'), mid = new THREE.Color('#fff2dc'), low = new THREE.Color('#d9b98d');
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 50;
    const c = y > 0 ? mid.clone().lerp(top, Math.min(1, y * 1.6)) : mid.clone().lerp(low, Math.min(1, -y * 3));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.04).texture;
  pm.dispose();
  return env;
}

// ---------- textures ----------

function sandTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#e7cfa1';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  const d = img.data;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      // wind ripples, tileable: integer frequencies across the tile
      const rip = Math.sin((x / 512) * Math.PI * 2 * 3 + Math.sin((y / 512) * Math.PI * 2 * 2) * 1.4 + (y / 512) * Math.PI * 2 * 9);
      const n = (Math.random() - 0.5) * 22 + rip * 2.5;
      d[i] += n; d[i + 1] += n * 0.94; d[i + 2] += n * 0.82;
    }
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 3200; k++) {
    g.fillStyle = Math.random() < 0.55 ? 'rgba(140,108,70,0.32)' : 'rgba(255,251,238,0.5)';
    const s = Math.random() < 0.9 ? 1 : 2;
    g.fillRect(Math.random() * 512, Math.random() * 512, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(48, 36);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Court slab in court frame: x ∈ [-8.5, 8.5], z ∈ [-1, 16].
const SLAB = { x0: -8.5, x1: 8.5, z0: -1.0, z1: 16.0 };

function courtTexture() {
  const S = 2048 / (SLAB.x1 - SLAB.x0);
  const W = 2048, H = Math.round((SLAB.z1 - SLAB.z0) * S);
  const [c, g] = canvas(W, H);
  const X = (x) => (x - SLAB.x0) * S;
  const Z = (z) => (z - SLAB.z0) * S;
  const rnd = mulberry32(7);
  const bz = HOOP.rimZ;

  g.fillStyle = COL.border; g.fillRect(0, 0, W, H);
  g.fillStyle = COL.court; g.fillRect(X(-7.5), Z(0), 15 * S, 14 * S);

  // inside the three-point line
  const R3 = 6.75, side = 6.6, zArc = bz + Math.sqrt(R3 * R3 - side * side);
  const a0 = Math.atan2(zArc - bz, side);
  g.save();
  g.beginPath();
  g.moveTo(X(-side), Z(0)); g.lineTo(X(-side), Z(zArc));
  g.arc(X(0), Z(bz), R3 * S, Math.PI - a0, a0, true);
  g.lineTo(X(side), Z(0)); g.closePath();
  g.fillStyle = COL.arc; g.fill();
  g.restore();

  g.fillStyle = COL.key; g.fillRect(X(-2.45), Z(0), 4.9 * S, 5.8 * S);

  // weathering: sun-faded blotches and darker stains
  for (let k = 0; k < 520; k++) {
    const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 160;
    const light = rnd() < 0.62;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, light ? 'rgba(255,236,210,0.045)' : 'rgba(60,30,20,0.04)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // lines
  g.strokeStyle = COL.line; g.lineWidth = 0.055 * S; g.lineCap = 'butt';
  const line = (pts) => { g.beginPath(); g.moveTo(X(pts[0][0]), Z(pts[0][1])); for (const p of pts.slice(1)) g.lineTo(X(p[0]), Z(p[1])); g.stroke(); };
  line([[-7.5, 14], [-7.5, 0], [7.5, 0], [7.5, 14]]);
  line([[-7.5, 14], [7.5, 14]]);
  g.strokeRect(X(-2.45), Z(0), 4.9 * S, 5.8 * S);
  line([[-side, 0], [-side, zArc]]); line([[side, 0], [side, zArc]]);
  g.beginPath(); g.arc(X(0), Z(bz), R3 * S, Math.PI - a0, a0, true); g.stroke();
  g.beginPath(); g.arc(X(0), Z(5.8), 1.8 * S, 0, Math.PI); g.stroke();
  g.setLineDash([0.32 * S, 0.28 * S]);
  g.beginPath(); g.arc(X(0), Z(5.8), 1.8 * S, Math.PI, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  g.beginPath(); g.arc(X(0), Z(bz), 1.25 * S, 0, Math.PI); g.stroke();
  g.beginPath(); g.arc(X(0), Z(14), 1.8 * S, Math.PI, Math.PI * 2); g.stroke();
  for (const z of [1.75, 2.6, 3.45, 4.3]) { line([[-2.45, z], [-2.75, z]]); line([[2.45, z], [2.75, z]]); }

  // fine grain, cracks and sand dust drifting onto the edges
  const img = g.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 8; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 26; k++) {
    let x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI * 2;
    g.strokeStyle = 'rgba(70,35,20,0.16)'; g.lineWidth = 1 + rnd() * 1.2;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 18; s++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); }
    g.stroke();
  }
  for (let k = 0; k < 26000; k++) {
    const x = rnd() * W, y = rnd() * H;
    const edge = Math.min(x, W - x, y, H - y) / S;      // metres to slab edge
    const p = Math.exp(-edge * 2.2) * (0.4 + fbm2(x / 160, y / 160));
    if (rnd() > p) continue;
    g.fillStyle = `rgba(232,206,160,${0.25 + rnd() * 0.45})`;
    const s = 1 + rnd() * 2.5;
    g.fillRect(x, y, s, s);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function boardTexture() {
  const [c, g] = canvas(512, 310);
  g.fillStyle = COL.board; g.fillRect(0, 0, 512, 310);
  g.strokeStyle = '#e6532c'; g.lineWidth = 14; g.strokeRect(7, 7, 498, 296);
  g.lineWidth = 11; g.strokeRect(256 - 64, 310 - 22 - 98, 128, 98);
  g.fillStyle = 'rgba(0,0,0,0.035)';
  for (let k = 0; k < 40; k++) g.fillRect(Math.random() * 512, Math.random() * 310, 30 + Math.random() * 80, 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function frondTexture() {
  const [c, g] = canvas(128, 512);
  const rnd = mulberry32(3);
  for (let i = 0; i < 64; i++) {
    const t = i / 64, y = 500 - t * 488;
    const len = 62 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02 + 0.06)), 0.7) * (0.85 + rnd() * 0.25);
    for (const s of [-1, 1]) {
      const hue = 95 + rnd() * 20, light = 30 + rnd() * 14;
      g.fillStyle = `hsl(${hue},45%,${light}%)`;
      const w = 4.5 * (1 - t * 0.5);
      g.beginPath();
      g.moveTo(64, y);
      g.quadraticCurveTo(64 + s * len * 0.5, y - len * 0.12 - w, 64 + s * len, y - len * 0.5);
      g.quadraticCurveTo(64 + s * len * 0.5, y - len * 0.12 + w, 64, y + w * 1.4);
      g.fill();
    }
  }
  g.strokeStyle = '#6d7a3c'; g.lineCap = 'round';
  for (let i = 0; i < 20; i++) { g.lineWidth = 5 - i * 0.2; g.beginPath(); g.moveTo(64, 510 - i * 25); g.lineTo(64, 510 - (i + 1) * 25); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function towelTexture() {
  const [c, g] = canvas(128, 256);
  const cols = ['#f3e7cf', '#e2663f', '#f3e7cf', '#2f8a87', '#f3e7cf', '#e2663f', '#f3e7cf'];
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i * 256) / cols.length, 128, 256 / cols.length + 1); });
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (let x = 0; x < 128; x += 6) { g.fillRect(x, 0, 3, 6); g.fillRect(x, 250, 3, 6); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- geometry ----------

function taperTube(curve, segs, radial, rFn) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], col = [], idx = [];
  const P = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const r = rFn(t);
    const band = 0.82 + 0.18 * Math.pow(Math.abs(Math.sin(t * 46)), 3);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      dir.copy(frames.normals[i]).multiplyScalar(Math.cos(v)).addScaledVector(frames.binormals[i], Math.sin(v));
      pos.push(P.x + dir.x * r, P.y + dir.y * r, P.z + dir.z * r);
      nor.push(dir.x, dir.y, dir.z);
      col.push(0.55 * band, 0.45 * band, 0.36 * band);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function frondGeometry(len) {
  const g = new THREE.PlaneGeometry(1.35, len, 4, 22);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const t = (y + len / 2) / len, s = t * len;
    p.setXYZ(i, x * (1 - 0.15 * t), s * 0.5 - s * s * 0.17 - Math.abs(x) * 0.32, s * 0.94);
  }
  g.computeVertexNormals();
  return g;
}

function makePalm(base, height, lean, seed, frondMat, frondDepth, trunkMat) {
  const rnd = mulberry32(seed);
  const g = new THREE.Group();
  const L = lean.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const pts = [0, 0.33, 0.68, 1].map((t) =>
    base.clone().addScaledVector(up, height * t).addScaledVector(L, height * (0.03 * t + 0.42 * t * t)));
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.Mesh(taperTube(curve, 40, 12, (t) => 0.24 * (1 - 0.42 * t) + 0.03 * Math.exp(-t * 18)), trunkMat);
  trunk.castShadow = true; trunk.receiveShadow = true;
  g.add(trunk);
  const top = pts[3];
  const fronds = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(frondGeometry(2.6 + rnd() * 1.3), frondMat);
    m.customDepthMaterial = frondDepth;
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.copy(top);
    pivot.rotation.order = 'YXZ';
    pivot.rotation.y = (i / n) * Math.PI * 2 + rnd() * 0.4;
    pivot.rotation.x = -0.15 + rnd() * 0.45;
    pivot.add(m);
    pivot.userData = { rx: pivot.rotation.x, ph: rnd() * 6.28 };
    fronds.push(pivot);
    g.add(pivot);
  }
  const nutMat = new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.7 });
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), nutMat);
    const a = i * 2.1;
    nut.position.copy(top).add(new THREE.Vector3(Math.cos(a) * 0.17, -0.18, Math.sin(a) * 0.17));
    nut.castShadow = true;
    g.add(nut);
  }
  return { group: g, fronds };
}

// ---------- hoop ----------

// Windows 的静态球网属于篮筐本体，画在桌面图标下面，不会随前层休眠闪烁或盖住图标。
function addStaticNet(g) {
  const K = 12, rows = 5, H = HOOP;
  const nodes = [];
  for (let i = 0; i <= rows; i++) {
    for (let k = 0; k < K; k++) {
      const a = ((k + (i % 2) * 0.5) / K) * Math.PI * 2;
      const rr = H.rimR * (1 - 0.42 * (i / rows));
      nodes.push(new THREE.Vector3(Math.cos(a) * rr, H.rimY - (i / rows) * H.netLen, H.rimZ + Math.sin(a) * rr));
    }
  }
  const id = (i, k) => i * K + ((k + K) % K);
  const links = [];
  for (let i = 0; i < rows; i++) for (let k = 0; k < K; k++) {
    links.push([id(i, k), id(i + 1, k)]);
    links.push([id(i, k), id(i + 1, i % 2 ? k + 1 : k - 1)]);
  }
  for (let k = 0; k < K; k++) links.push([id(rows, k), id(rows, k + 1)]);

  const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: COL.net, roughness: 0.9 }), links.length);
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), q = new THREE.Quaternion();
  const m = new THREE.Matrix4(), scale = new THREE.Vector3();
  links.forEach(([a, b], i) => {
    d.subVectors(nodes[b], nodes[a]);
    const len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    scale.set(0.011, len, 0.011);
    m.compose(nodes[a], q, scale);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  g.add(mesh);
}

export function buildHoop() {
  const g = new THREE.Group();
  const H = HOOP;
  const poleMat = new THREE.MeshStandardMaterial({ color: COL.pole, roughness: 0.45, metalness: 0.35 });
  const padMat = new THREE.MeshStandardMaterial({ color: COL.pad, roughness: 0.85 });
  const boardFront = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.28 });
  const rimMat = new THREE.MeshStandardMaterial({ color: COL.rim, roughness: 0.35, metalness: 0.45 });

  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(0.7, 0.05, 0.7), poleMat, 0, 0.025, H.poleZ);
  add(new THREE.CylinderGeometry(H.poleR, H.poleR * 1.08, H.poleH, 24), poleMat, 0, H.poleH / 2, H.poleZ);
  add(new THREE.CylinderGeometry(H.poleR + 0.045, H.poleR + 0.045, 1.1, 24), padMat, 0, 0.6, H.poleZ);

  const boardCY = H.boardBottom + H.boardH / 2;
  const arm = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, H.poleH - 0.12, H.poleZ),
    new THREE.Vector3(0, H.poleH + 0.16, H.poleZ + 0.4),
    new THREE.Vector3(0, H.poleH + 0.1, H.boardZ - 0.75),
    new THREE.Vector3(0, boardCY + 0.1, H.boardZ - H.boardT - 0.02),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(arm, 40, 0.065, 12), poleMat));
  const strut = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, H.poleH - 0.9, H.poleZ + 0.05),
    new THREE.Vector3(0, boardCY - 0.25, H.boardZ - H.boardT - 0.02),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(strut, 8, 0.04, 8), poleMat));

  const boardMats = [poleMat, poleMat, poleMat, poleMat, boardFront, poleMat];
  const board = add(new THREE.BoxGeometry(H.boardW, H.boardH, H.boardT), boardMats, 0, boardCY, H.boardZ - H.boardT / 2);
  board.name = 'board';

  const rim = add(new THREE.TorusGeometry(H.rimR, H.tube, 12, 64), rimMat, 0, H.rimY, H.rimZ);
  rim.rotation.x = Math.PI / 2;
  const bracketLen = H.rimZ - H.rimR - H.boardZ;
  add(new THREE.BoxGeometry(0.2, 0.09, bracketLen), rimMat, 0, H.rimY - 0.02, H.boardZ + bracketLen / 2);

  addStaticNet(g);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------- world ----------

// Either renderer may be null: the Mac app runs the back and front layers in separate windows.
export function buildWorld(backRenderer, frontRenderer) {
  const back = backRenderer ? buildBack(backRenderer) : null;
  const front = frontRenderer ? buildFront(frontRenderer) : null;
  const daylight = new Daylight([back?.rig, front?.rig].filter(Boolean), [backRenderer, frontRenderer].filter(Boolean));
  return {
    back: back?.scene, front: front?.scene,
    hoop: backRenderer ? back?.hoop : front?.hoop,
    scoreboard: backRenderer ? back?.scoreboard : front?.scoreboard,
    update(t) { back?.update(t); },
    // noon | morning | dusk | night | auto
    setTime(mode, instant) { daylight.set(mode, instant); },
    get time() { return daylight.mode; },
    // eases between times; true while it does
    tick(dt) { return daylight.tick(dt); },
  };
}

function buildBack(renderer) {
  const back = new THREE.Scene();
  back.background = new THREE.Color('#e7cfa1');
  back.environment = skyEnvironment(renderer);
  back.environmentIntensity = 0.45;
  const backLights = addLights(back, 4096);
  const backLamps = floodlights(back, { poles: true });

  // sand, with large soft tonal drift
  const sandGeo = new THREE.PlaneGeometry(170, 130, 170, 130);
  sandGeo.rotateX(-Math.PI / 2);
  const sp = sandGeo.attributes.position, sc = [];
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), z = sp.getZ(i);
    const n = fbm2(x * 0.06 + 3, z * 0.06 + 7);
    const k = 0.93 + n * 0.12;
    sc.push(k, k * 0.995, k * 0.985);
  }
  sandGeo.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const sand = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ map: sandTexture(), vertexColors: true, roughness: 0.97 }));
  sand.position.y = -0.06;
  sand.receiveShadow = true;
  back.add(sand);

  // court
  const courtBack = new THREE.Group();
  courtBack.applyMatrix4(courtMatrix);
  back.add(courtBack);
  const slabW = SLAB.x1 - SLAB.x0, slabD = SLAB.z1 - SLAB.z0;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(slabW, 0.1, slabD), new THREE.MeshStandardMaterial({ color: COL.slab, roughness: 0.85 }));
  slab.position.set(0, -0.05, (SLAB.z0 + SLAB.z1) / 2);
  slab.receiveShadow = true; slab.castShadow = true;
  courtBack.add(slab);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(slabW, slabD), new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.78 }));
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, 0.001, (SLAB.z0 + SLAB.z1) / 2);
  top.receiveShadow = true;
  courtBack.add(top);

  // Windows 版把篮筐和记分牌画在桌面图标下面，图标永远不会被它们盖住。
  const hoop = buildHoop();
  hoop.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  courtBack.add(hoop);
  const scoreboard = buildScoreboard();
  back.add(scoreboard.group);

  // sea
  const seaMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    // colours are set per time of day (times.js); noon's are the original constants
    uniforms: {
      uTime: { value: 0 }, uShore: { value: CFG.shoreZ },
      ...Object.fromEntries(['uShallow', 'uMid', 'uDeep', 'uUnder', 'uWet', 'uFoam', 'uGlint', 'uHaze'].map((k) => [k, { value: new THREE.Vector3() }])),
      ...Object.fromEntries(['uGlintAmt', 'uBright', 'uHazeAmt', 'uPathX', 'uPathAmt', 'uBio'].map((k) => [k, { value: 0 }])),
    },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uShore; varying vec3 vW;
      uniform vec3 uShallow, uMid, uDeep, uUnder, uWet, uFoam, uGlint, uHaze;
      uniform float uGlintAmt, uBright, uHazeAmt, uPathX, uPathAmt, uBio;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
      vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
      float shore(float x){ return uShore + 1.1*sin(x*0.17+0.6) + 0.45*sin(x*0.41+2.0); }
      void main(){
        float t = uTime;
        float d = shore(vW.x) - vW.z;
        float n = fbm(vW.xz*0.35 + vec2(t*0.03, -t*0.02));
        float swash = 0.5*sin(t*0.42) + 0.2*sin(t*0.97 + vW.x*0.21) + (n-0.5)*0.8;
        float dw = d + swash;
        float water = smoothstep(-0.03, 0.1, dw);
        float k = clamp(dw/9.0, 0., 1.);
        vec3 col = mix(lin(uShallow), lin(uMid), smoothstep(0.,0.3,k));
        col = mix(col, lin(uDeep), smoothstep(0.2,0.9,k));
        col = mix(lin(uUnder), col, smoothstep(0.0, 1.6, dw));
        float big = fbm(vW.xz*0.12 + vec2(t*0.01, 0.));
        col *= 0.88 + 0.22*big;
        float rip = fbm(vW.xz*vec2(0.9,2.6) + vec2(0., t*0.22));
        col *= 0.95 + 0.1*rip;
        float fN = fbm(vW.xz*2.4 + vec2(t*0.14, t*0.05));
        float phase = dw*1.3 + t*0.9 + n*2.2;
        float crest = pow(max(0., sin(phase)), 60.0) * smoothstep(6.0, 1.5, dw) * smoothstep(0.4, 1.4, dw) * smoothstep(0.42, 0.72, fN);
        float edge = smoothstep(0.55, 0.0, dw) * water;
        float foam = clamp(edge*(0.4+0.8*fN) + crest*0.8, 0., 1.);
        col = mix(col, uFoam, foam*0.92);
        // sparkles, thicker along the path toward a low sun or the moon
        float path = uPathAmt * exp(-pow((vW.x - uPathX) / 7.0, 2.0));
        float gl = noise(vW.xz*vec2(4.0,8.0) + vec2(t*0.5, t*0.8));
        col += uGlint * smoothstep(0.965 - path*0.07, 0.998, gl) * smoothstep(2.0, 7.0, dw) * uGlintAmt;
        col += lin(uGlint) * path * 0.12 * smoothstep(2.0, 9.0, dw);
        col = mix(col, lin(uHaze), uHazeAmt * smoothstep(4.0, 22.0, dw));
        // night: the breaking waves glow faintly blue
        col += vec3(0.08, 0.55, 0.75) * uBio * (edge*(0.5 + fN) + crest*0.9);
        float wet = smoothstep(-2.0, 0.0, dw) * (1.0 - water);
        float a = max(water*0.97, wet*0.42);
        gl_FragColor = vec4(mix(lin(uWet), col * uBright, water), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(240, 90), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.045, CFG.shoreZ - 40);
  back.add(sea);

  // palms: one leaning in from the right edge, one by the water, one off-screen for shade only
  const fTex = frondTexture();
  const frondMat = new THREE.MeshStandardMaterial({ map: fTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
  const frondDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: fTex, alphaTest: 0.5 });
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const palms = [
    makePalm(new THREE.Vector3(15.5, 0, -3.5), 8.5, new THREE.Vector3(-1, 0, 0.15), 11, frondMat, frondDepth, trunkMat),
    makePalm(new THREE.Vector3(-12.8, 0, -10.6), 7.0, new THREE.Vector3(-0.5, 0, 0.6), 23, frondMat, frondDepth, trunkMat),
    makePalm(new THREE.Vector3(17.5, 0, 9.5), 9.0, new THREE.Vector3(-1, 0, -0.3), 37, frondMat, frondDepth, trunkMat),
  ];
  palms.forEach((p) => back.add(p.group));

  // a towel and flip-flops on the sand
  const towel = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.0), new THREE.MeshStandardMaterial({ map: towelTexture(), roughness: 1 }));
  towel.rotation.set(-Math.PI / 2, 0, 0.5);
  towel.position.set(-11.2, -0.035, 3.6);
  towel.receiveShadow = true;
  back.add(towel);
  const flopMat = new THREE.MeshStandardMaterial({ color: '#2f8a87', roughness: 0.7 });
  [[-10.0, 4.9, 0.3], [-9.7, 5.1, 0.55]].forEach(([x, z, r]) => {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.16, 4, 10), flopMat);
    f.scale.set(1, 1, 0.18);
    f.rotation.set(Math.PI / 2, 0, r);
    f.position.set(x, -0.03, z);
    f.castShadow = true;
    back.add(f);
  });

  return {
    scene: back, hoop, scoreboard,
    rig: { ...backLights, scene: back, sea: seaMat, lamps: backLamps },
    update(t) {
      seaMat.uniforms.uTime.value = t;
      for (const p of palms) for (const f of p.fronds) {
        f.rotation.x = f.userData.rx + Math.sin(t * 1.1 + f.userData.ph) * 0.035 + Math.sin(t * 0.37) * 0.02;
      }
    },
  };
}

// The visible hoop + a catcher that draws only the balls' shadows.
function buildFront(renderer) {
  const front = new THREE.Scene();
  front.environment = skyEnvironment(renderer);
  front.environmentIntensity = 0.45;
  const frontLights = addLights(front, 2048);
  const frontLamps = floodlights(front, { poles: false });
  // 前层只负责纸团和阴影；篮筐/记分牌的可见副本在 back 层，避免遮住桌面图标。
  // 仍创建不可见的引用对象，供点击命中、坐标投影和记分牌状态计算使用。
  const hoop = buildHoop();
  hoop.visible = false;
  const scoreboard = buildScoreboard();
  scoreboard.group.visible = false;
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x3b2414, opacity: 0.34 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.002;
  catcher.receiveShadow = true;
  front.add(catcher);
  return { scene: front, hoop, scoreboard, rig: { ...frontLights, scene: front, catcher, lamps: frontLamps } };
}

