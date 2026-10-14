import * as THREE from '../vendor/three/three.module.js';
import { buildWorld, makeCamera, fitCamera, rimCenter, toWorld, HOOP, LOOK } from './scene.js';
import { BallSystem } from './ball.js';
import { Desktop, FILES, loadIconImages, ICON_URL, iconEl, animateCrumple, animateRestore } from './desktop.js';
import { sfx } from './sfx.js';
import { Aim } from './aim.js';

const $ = (s) => document.querySelector(s);
const Q = new URLSearchParams(location.search);

// demo  — everything in one page, with a fake desktop (the browser prototype)
// back  — sand, sea, court: the Mac app shows this under the Finder icons
// front — hoop and paper balls: the Mac app shows this over the Finder icons
const LAYER = Q.get('layer') || 'demo';
const HAS_BACK = LAYER !== 'front', HAS_FRONT = LAYER !== 'back';
document.body.dataset.layer = LAYER;
const native = window.webkit?.messageHandlers?.court;
const post = (m) => native?.postMessage(m);

function renderer(canvas, alpha) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.setSize(innerWidth, innerHeight, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  r.toneMapping = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }[Q.get('tm') || 'neutral'];
  r.toneMappingExposure = Number(Q.get('exp') || 1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  if (alpha) r.setClearColor(0x000000, 0);
  return r;
}

const backR = HAS_BACK ? renderer($('#back'), false) : null;
const frontR = HAS_FRONT ? renderer($('#front'), true) : null;
const camera = makeCamera(innerWidth / innerHeight);
const world = buildWorld(backR, frontR);
world.setTime(Q.get('time') || 'noon', true);
const images = await loadIconImages();

let balls = null, desk = null, aim = null, lastPointer = null;
let lastActive = performance.now(), paused = false;
const basket = [], shots = [];   // demo: what went in, and each shot's files for ⌃⌥Z
const stats = { made: 0, attempts: 0 };   // the scoreboard: made / attempts

// ---------- hints and toasts ----------

const HINTS = {
  start: '框选几个文件，双指捏合（或右键）把它们揉成纸团',
  ball: '指针瞄准，按住空格蓄力，松手投篮 · 条上的刻线是你上一投的力度 · Esc 取消蓄力',
  miss: '没进。点一下纸团再投，或 ⌃⌥Z 放回桌面',
  scored: '进了。⌃⌥Z 可以把这一球放回桌面，点篮板看投进去的文件',
};
let hintTimer;
function hint(key, hideAfter) {
  if (LAYER === 'back' || (LAYER === 'front' && key === 'start')) return;
  const h = $('#hint');
  h.textContent = HINTS[key];
  h.style.opacity = 1;
  clearTimeout(hintTimer);
  if (hideAfter) hintTimer = setTimeout(() => (h.style.opacity = 0), hideAfter);
}

// Scoreboard. The app keeps the numbers (front layer); the browser demo keeps them in localStorage.
function showStats(animate = true) {
  world.scoreboard?.set(stats.made, stats.attempts, animate);
  lastActive = performance.now();
}
function saveStats() {
  if (LAYER === 'front') post({ type: 'stats', ...stats });
  else try { localStorage.setItem('court-stats', JSON.stringify(stats)); } catch {}
}
if (LAYER === 'demo') try { Object.assign(stats, JSON.parse(localStorage.getItem('court-stats') || '{}')); } catch {}

// left of the backboard, over open sand: clear of the hoop, the scoreboard and the menu bar
function toast(text) {
  const t = $('#toast'), s = balls.toScreen(toWorld(-HOOP.boardW / 2 - 0.35, HOOP.boardBottom + HOOP.boardH * 0.45, HOOP.boardZ));
  t.textContent = text;
  Object.assign(t.style, { left: `${s.x}px`, top: `${s.y}px` });
  t.animate([
    { opacity: 0, transform: 'translate(calc(-100% + 8px), -50%) scale(.92)' },
    { opacity: 1, transform: 'translate(-100%, -50%) scale(1)', offset: 0.12 },
    { opacity: 1, transform: 'translate(-100%, -50%) scale(1)', offset: 0.82 },
    { opacity: 0, transform: 'translate(calc(-100% - 6px), -50%) scale(1)' },
  ], { duration: 2400, easing: 'ease-out', fill: 'forwards' });
}

const centroid = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

// ---------- the basket window (demo only; the Mac app opens the folder in Finder) ----------

function renderBasket() {
  const w = $('#basket'), grid = w.querySelector('.grid');
  grid.innerHTML = basket.length ? '' : '<div class="empty">还没有投进去的文件</div>';
  for (const f of basket) {
    const d = document.createElement('div');
    d.className = 'bi';
    d.innerHTML = `<img src="${ICON_URL[f.type]}"><span></span>`;
    d.querySelector('span').textContent = f.name;
    grid.appendChild(d);
  }
  w.querySelector('button').disabled = !basket.length;
}
function toggleBasket(show = $('#basket').style.display !== 'block') {
  const w = $('#basket');
  if (!show) { w.style.display = 'none'; return; }
  renderBasket();
  const s = balls.toScreen(rimCenter);
  Object.assign(w.style, { display: 'block', left: `${Math.max(12, s.x - 60)}px`, top: `${Math.min(innerHeight - 320, s.y + 120)}px` });
}
function openBasket() {
  if (LAYER === 'demo') toggleBasket(); else post({ type: 'openBasket' });
}

// ---------- front layer: balls, the throw, the hoop ----------

if (HAS_FRONT) {
  balls = new BallSystem({
    scene: world.front, camera, images, sfx,
    onScore: (b) => {
      toast(`${b.files.length} 个文件进了篮筐 · ⌃⌥Z 放回`); hint('scored', 5000);
      aim.result(b, true);
      stats.made = Math.min(stats.made + 1, stats.attempts); showStats(); saveStats();
    },
    onBanked: (b) => {
      if (LAYER === 'demo') { basket.push(...b.files); shots.push({ files: b.files, t: performance.now() }); if ($('#basket').style.display === 'block') renderBasket(); }
      else post({ type: 'banked', id: b.id });
    },
  });

  const ray = new THREE.Raycaster();
  const hits = (obj) => (x, y) => {
    ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
    return ray.intersectObject(obj, true).length > 0;
  };
  const hoopHit = hits(world.hoop), scoreHit = hits(world.scoreboard.group);

  // Clicking the scoreboard opens the app's menu (the menu-bar icon can end up hidden behind the
  // notch). In the browser demo it steps through the times of day instead.
  const DEMO_TIMES = ['noon', 'morning', 'dusk', 'night'];
  function scoreboardClicked(x, y) {
    if (LAYER === 'front') return post({ type: 'menu', x, y });
    const next = DEMO_TIMES[(DEMO_TIMES.indexOf(world.time) + 1) % DEMO_TIMES.length];
    world.setTime(next);
    lastActive = performance.now();
  }

  aim = new Aim({ balls, scene: world.front, root: $('#fx'), sfx, onShot: (b) => { watchMiss(b); stats.attempts++; showStats(); saveStats(); } });
  showStats(false);

  // Click a ball to pick it up; drag it to carry it somewhere else. Clicking anywhere else puts it down.
  // two clicks on the same ball within this long unfold it (not left to the browser's dblclick,
  // which WebKit can swallow after pointerdown handling)
  const DOUBLE_MS = 450;
  let held = null, lastTap = { b: null, t: 0 };
  addEventListener('pointerdown', (e) => {
    sfx.unlock();
    lastActive = performance.now();
    if (e.button !== 0) return;
    const b = balls.hit(e.clientX, e.clientY);
    if (b) {
      e.stopPropagation(); e.preventDefault();
      const now = performance.now();
      if (lastTap.b === b && now - lastTap.t < DOUBLE_MS) {
        lastTap = { b: null, t: 0 };
        if (aim.b === b) aim.end(false);
        unpack(b);
        return;
      }
      lastTap = { b, t: now };
      if (aim.b !== b) aim.start(b, { x: e.clientX, y: e.clientY });
      held = b; balls.grab(b, e.clientX, e.clientY);
      document.body.classList.add('grabbing');
      return;
    }
    if (e.target.closest?.('#basket, #ctxmenu')) return;
    if (hoopHit(e.clientX, e.clientY)) { e.stopPropagation(); openBasket(); return; }
    if (scoreHit(e.clientX, e.clientY)) { e.stopPropagation(); scoreboardClicked(e.clientX, e.clientY); return; }
    aim.end(true);
    if (LAYER === 'demo') toggleBasket(false);
  }, true);
  addEventListener('pointermove', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (aim.active) aim.point(e.clientX, e.clientY);
    if (held) { balls.move(held, e.clientX, e.clientY); e.stopPropagation(); return; }
    document.body.classList.toggle('can-grab', !!balls.hit(e.clientX, e.clientY));
    document.body.classList.toggle('can-open', hoopHit(e.clientX, e.clientY) || scoreHit(e.clientX, e.clientY));
  }, true);
  addEventListener('pointerup', (e) => {
    if (!held) return;
    e.stopPropagation();
    const b = held; held = null;
    document.body.classList.remove('grabbing');
    if (b.state === 'held') balls.release(b);
  }, true);

  // Space is only taken while a ball is in hand; otherwise it stays Finder's Quick Look.
  addEventListener('keydown', (e) => {
    if (!aim.active) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) aim.press(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); aim.turn(-0.03); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); aim.turn(0.03); }
    else if (e.key === 'Escape') { if (aim.charging) aim.cancelCharge(); else aim.end(true); }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space' && aim.charging) { e.preventDefault(); aim.letGo(); } });
  addEventListener('blur', () => aim.cancelCharge());

  function watchMiss(b) {
    const check = () => {
      if (b.scored || b.state === 'gone' || b.state === 'held') return;
      if (b.state === 'rest') return hint('miss', 3500);
      setTimeout(check, 200);
    };
    setTimeout(check, 400);
  }

  // Tell the Mac app where the balls and the hoop are, so it only takes the mouse there.
  let lastHit = '';
  // only the backboard (opens the basket) and the scoreboard (opens the menu) take clicks;
  // icons under the pole stay clickable
  const rectOf = (obj) => {
    const box = new THREE.Box3().setFromObject(obj), pts = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(balls.toScreen(new THREE.Vector3(x, y, z)));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)), w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)) };
  };
  let hoopBox = null, scoreBox = null;
  if (LAYER === 'front') balls.report = () => {
    hoopBox ??= rectOf(world.hoop.getObjectByName('board'));
    scoreBox ??= rectOf(world.scoreboard.group);
    const msg = { type: 'hit', circles: balls.circles(), hoop: hoopBox, score: scoreBox, holding: !!held, aiming: aim.active };
    const key = JSON.stringify(msg);
    if (key !== lastHit) { lastHit = key; post(msg); }
  };
  balls.resetHoop = () => { hoopBox = scoreBox = null; };
}

// Files coming back out of a ball.
const restoring = new Map(), dropped = new Set();
function unpack(b) {
  const from = balls.toScreen(b.pos);
  balls.remove(b);
  sfx.unfold();
  if (LAYER === 'demo') { desk.restore(b.files, from); return; }
  const els = b.files.map((f) => { const el = iconEl(f.name, f.src); Object.assign(el.style, { left: `${f.x}px`, top: `${f.y}px` }); $('#fx').appendChild(el); return el; });
  animateRestore(els, b.files, from);
  restoring.set(b.id, els);
  post({ type: 'unpack', id: b.id });
  setTimeout(() => window.court.restored(b.id), 3000);
}

// ---------- bridge for the Mac app (front layer) ----------

window.court = {
  // items: [{ name, src (data URL), x, y }] — x, y: centre of each Finder icon, in window points
  async crumple(id, items, iconSize = 64) {
    document.documentElement.style.setProperty('--s', iconSize / 64);
    lastActive = performance.now();
    const els = items.map((it) => {
      const el = iconEl(it.name, it.src);
      Object.assign(el.style, { left: `${it.x}px`, top: `${it.y}px` });
      $('#fx').appendChild(el);
      return el;
    });
    // the copies now cover the real icons — the app can move the files away
    requestAnimationFrame(() => requestAnimationFrame(() => post({ type: 'covered', id })));
    const loaded = await Promise.all(items.map((it) => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = it.src;
    })));
    const files = items.map((it, i) => ({ ...it, image: loaded[i] }));
    const target = centroid(items);
    sfx.crumple(items.length);
    const ms = animateCrumple(els, items, target);
    setTimeout(() => {
      if (dropped.has(id)) return;
      const b = balls.spawn(files, target.x, target.y, id);
      setTimeout(() => { aim.start(b, lastPointer); hint('ball', 7000); }, 320);
    }, 400 + items.length * 12);
    setTimeout(() => els.forEach((el) => el.remove()), ms);
  },
  // the app hands over the saved numbers on load, and zeroes them from the menu
  setStats(made, attempts) { Object.assign(stats, { made, attempts }); showStats(false); },
  // ⌃⌥Z from the app for a ball still in play: true if it was here and is now unfolding
  unpackBall(id) {
    const b = balls?.balls.find((x) => x.id === id && !x.scored && x.state !== 'gone');
    if (!b) { dropped.add(id); return false; }
    if (aim.b === b) aim.end(false);
    unpack(b);
    return true;
  },
  // a made shot is being put back: copies fly out of the hoop to where the icons were
  fromHoop(id, items, iconSize = 64) {
    document.documentElement.style.setProperty('--s', iconSize / 64);
    lastActive = performance.now();
    const els = items.map((it) => { const el = iconEl(it.name, it.src); Object.assign(el.style, { left: `${it.x}px`, top: `${it.y}px` }); $('#fx').appendChild(el); return el; });
    sfx.unfold();
    animateRestore(els, items, balls.toScreen(rimCenter));
    restoring.set(id, els);
    setTimeout(() => window.court.restored(id), 4000);
  },
  // the files are back on the desktop; fade out the stand-in icons
  restored(id) {
    const els = restoring.get(id);
    if (!els) return;
    restoring.delete(id);
    els.forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).finished.then(() => el.remove()));
  },
  // while a ball is in hand the app forwards the pointer, since the overlay doesn't take the mouse
  pointer(x, y) { lastPointer = { x, y }; aim?.point(x, y); },
  outside() { aim?.end(true); },
  // time of day from the app's menu: noon (the original) | morning | dusk | night | auto
  setTime(mode, instant = false) { world.setTime(mode, instant); lastActive = performance.now(); },
  // the app pauses the wallpaper layer while windows cover the desktop
  pause(on) { paused = on; },
  ids: () => (balls ? balls.balls.map((b) => b.id) : []),
  // debug: render this layer now and return it as a PNG data URL
  snap() {
    const r = backR || frontR;
    if (backR) { world.update((performance.now() - t0) / 1000); backR.render(world.back, camera); }
    else frontR.render(world.front, camera);
    return r.domElement.toDataURL('image/png');
  },
};

// ---------- demo: the fake desktop ----------

if (LAYER === 'demo') {
  desk = new Desktop($('#desk'), FILES, {
    onCrumple(files, target) {
      sfx.crumple(files.length);
      setTimeout(() => {
        const b = balls.spawn(files, target.x, target.y);
        hint('ball');
        setTimeout(() => aim.start(b, lastPointer), 320);
      }, 400 + files.length * 12);
    },
  });
  hint('start');
  // ⌃⌥Z: undo the newest crumple — unfold it if it's on the court, take it out of the basket if it went in
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.altKey && e.code === 'KeyZ')) return;
    e.preventDefault();
    const ball = balls.balls.filter((b) => !b.scored && b.state !== 'gone').sort((a, b) => b.born - a.born)[0];
    const shot = shots[shots.length - 1];
    if (ball && (!shot || ball.born > shot.t)) { if (aim.b === ball) aim.end(false); unpack(ball); return; }
    if (!shot) return;
    const files = shots.pop().files;
    for (const f of files) basket.splice(basket.indexOf(f), 1);
    desk.restore(files, balls.toScreen(rimCenter));
    sfx.unfold();
    if ($('#basket').style.display === 'block') renderBasket();
  });
  $('#basket button').addEventListener('click', () => {
    shots.length = 0;
    desk.restore(basket.splice(0), balls.toScreen(rimCenter));
    sfx.unfold();
    toggleBasket(false);
  });
  $('#basket .close').addEventListener('click', () => toggleBasket(false));
  const clock = () => {
    const d = new Date(), w = '日一二三四五六'[d.getDay()];
    $('#clock').textContent = `${d.getMonth() + 1}月${d.getDate()}日 周${w} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  clock(); setInterval(clock, 15000);
}

// ---------- loop ----------

function resize() {
  for (const r of [backR, frontR]) r?.setSize(innerWidth, innerHeight, false);
  fitCamera(camera, innerWidth / innerHeight);
  balls?.resize(innerWidth, innerHeight);
  balls?.resetHoop?.();
  desk?.layout();
  lastActive = performance.now();
}
addEventListener('resize', resize);

const t0 = performance.now();
let last = t0, frameNo = 0;
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  frameNo++;
  // the wallpaper layer runs at 30 fps on its own; the front layer sleeps when nothing moves
  if (world.tick(dt)) lastActive = now;   // easing to another time of day
  if (backR && !paused && (LAYER === 'demo' || frameNo % 2 === 0)) {
    world.update((now - t0) / 1000);
    backR.render(world.back, camera);
  }
  if (frontR) {
    balls.update(dt);
    aim.update(dt);
    if (world.scoreboard?.tick(dt)) lastActive = now;
    if (balls.balls.length) lastActive = now;
    if (now - lastActive < 3000 || frameNo < 5) frontR.render(world.front, camera);
    balls.report?.();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (native) { console.log(`court ${LAYER} ready ${innerWidth}x${innerHeight} @${devicePixelRatio}x · scoreboard: ${LOOK}`); post({ type: 'ready', layer: LAYER }); }
window.__court = { desk, balls, aim, camera, world, basket, rimCenter, rimScreen: () => balls.toScreen(rimCenter) };
