// A stand-in for the Finder desktop: icons, rubber-band selection, moving icons,
// and the two ways to crumple a selection (trackpad pinch, or right-click).
// In the Mac app this file is replaced by the real Finder desktop.

const page = (lines, badge, color) => `
  <path d="M15 4h24l11 11v43a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff" stroke="#cfcfd4" stroke-width="1"/>
  <path d="M39 4v9a2 2 0 0 0 2 2h9z" fill="#e4e4ea"/>
  ${lines}
  ${badge ? `<rect x="15" y="44" width="${badge.length * 7 + 8}" height="11" rx="2" fill="${color}"/>
  <text x="${19}" y="52.6" font-family="-apple-system,Helvetica" font-weight="700" font-size="8" fill="#fff">${badge}</text>` : ''}`;
const textLines = (c = '#c9ccd4', n = 7) => Array.from({ length: n }, (_, i) =>
  `<rect x="19" y="${19 + i * 3.6}" width="${i % 3 === 2 ? 16 : 26}" height="1.6" rx=".8" fill="${c}"/>`).join('');

const SVG = {
  folder: `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ad2fb"/><stop offset="1" stop-color="#47a6ea"/></linearGradient></defs>
    <path d="M6 15a3 3 0 0 1 3-3h14.5l4 4H55a3 3 0 0 1 3 3v3H6z" fill="#3c95da"/>
    <rect x="6" y="19" width="52" height="35" rx="3.2" fill="url(#f)"/>
    <rect x="6" y="19" width="52" height="1.6" fill="#c4e8ff" opacity=".8"/>`,
  pdf: page(textLines(), 'PDF', '#e5483b'),
  docx: page(textLines('#b7c8e8'), 'DOCX', '#2b6cd4'),
  xlsx: page(Array.from({ length: 6 }, (_, i) => `<rect x="18" y="${18 + i * 4.2}" width="28" height="3.2" fill="${i ? '#e3f3e8' : '#9fd9b1'}" stroke="#bfe2c9" stroke-width=".4"/>`).join(''), 'XLSX', '#1f9d55'),
  txt: page(textLines('#b9bcc4', 9), '', ''),
  zip: page(Array.from({ length: 7 }, (_, i) => `<rect x="${i % 2 ? 30 : 33}" y="${8 + i * 4}" width="3" height="2.6" fill="#8b8f99"/>`).join('') + '<rect x="29" y="37" width="8" height="6" rx="1" fill="#8b8f99"/>', 'ZIP', '#7a7f8a'),
  shot: `<rect x="3" y="14" width="58" height="37" rx="1.5" fill="#fff" stroke="#d3d3d8"/>
    <rect x="5" y="16" width="54" height="33" fill="#eef1f6"/><rect x="5" y="16" width="54" height="5" fill="#d9dde5"/>
    <circle cx="8" cy="18.5" r="1.1" fill="#ff5f57"/><circle cx="11.5" cy="18.5" r="1.1" fill="#febc2e"/><circle cx="15" cy="18.5" r="1.1" fill="#28c840"/>
    <rect x="8" y="24" width="12" height="22" rx="1" fill="#d7dce6"/><rect x="23" y="24" width="32" height="6" rx="1" fill="#7aa7f0"/>
    <rect x="23" y="33" width="26" height="2" fill="#c4c9d4"/><rect x="23" y="37" width="30" height="2" fill="#c4c9d4"/><rect x="23" y="41" width="20" height="2" fill="#c4c9d4"/>`,
  photo: `<rect x="5" y="11" width="54" height="42" rx="1.5" fill="#fff" stroke="#d3d3d8"/>
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf8a"/><stop offset=".55" stop-color="#ff8f6b"/><stop offset=".56" stop-color="#3fa7b8"/><stop offset="1" stop-color="#1f6f8f"/></linearGradient></defs>
    <rect x="7" y="13" width="50" height="38" fill="url(#s)"/><circle cx="40" cy="28" r="5" fill="#fff3cf"/>`,
  photo2: `<rect x="5" y="11" width="54" height="42" rx="1.5" fill="#fff" stroke="#d3d3d8"/>
    <rect x="7" y="13" width="50" height="38" fill="#9fd4f2"/><path d="M7 51 L22 30 L31 40 L41 26 L57 45 V51z" fill="#3e8a5c"/><path d="M7 51 L20 38 L30 51z" fill="#2f6f49"/>`,
  mov: `<rect x="4" y="13" width="56" height="38" rx="2" fill="#1e2127"/>
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${7 + i * 7.6}" y="15" width="4" height="2.4" rx=".5" fill="#555a63"/><rect x="${7 + i * 7.6}" y="46.6" width="4" height="2.4" rx=".5" fill="#555a63"/>`).join('')}
    <rect x="7" y="19.5" width="50" height="25" fill="#4b6f8f"/><path d="M28 25 L39 32 L28 39z" fill="#fff" opacity=".92"/>`,
};

export const ICON_URL = Object.fromEntries(Object.entries(SVG).map(([k, v]) =>
  [k, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${v}</svg>`)]));

export function loadIconImages() {
  return Promise.all(Object.entries(ICON_URL).map(([k, url]) => new Promise((res) => {
    const img = new Image(); img.onload = () => res([k, img]); img.src = url;
  }))).then(Object.fromEntries);
}

export const FILES = [
  ['截屏2026-10-12 15.42.11.png', 'shot', 0.935, 0.07],
  ['截屏2026-10-13 09.03.27.png', 'shot', 0.935, 0.215],
  ['合同扫描.pdf', 'pdf', 0.935, 0.36],
  ['待整理', 'folder', 0.935, 0.505],
  ['报销单-10月.xlsx', 'xlsx', 0.865, 0.07],
  ['IMG_2041.HEIC', 'photo', 0.865, 0.215],
  ['素材-备份.zip', 'zip', 0.865, 0.36],
  ['最终版-改3.docx', 'docx', 0.615, 0.5],
  ['最终版-真的最终版.docx', 'docx', 0.655, 0.545],
  ['发票.pdf', 'pdf', 0.59, 0.62],
  ['demo-录屏.mov', 'mov', 0.705, 0.64],
  ['新建文本文档.txt', 'txt', 0.65, 0.705],
  ['IMG_2047.HEIC', 'photo2', 0.555, 0.72],
  ['未命名文件夹', 'folder', 0.72, 0.5],
  ['未命名文件夹 2', 'folder', 0.765, 0.775],
  ['草稿.txt', 'txt', 0.51, 0.565],
  ['壁纸-海边.jpg', 'photo', 0.8, 0.6],
  ['截屏2026-10-13 11.20.05.png', 'shot', 0.685, 0.82],
  ['会议纪要.docx', 'docx', 0.33, 0.82],
  ['课程表.pdf', 'pdf', 0.41, 0.86],
].map(([name, type, fx, fy], i) => ({ id: i, name, type, fx, fy }));

const MENU_H = 30;

export function iconEl(name, src) {
  const el = document.createElement('div');
  el.className = 'icon';
  el.innerHTML = `<div class="img"><img draggable="false"></div><div class="label"><span></span></div>`;
  el.querySelector('img').src = src;
  el.querySelector('span').textContent = name;
  return el;
}

// Icons lift, get pulled together and scrunch up. centers: each icon image's centre on screen.
export function animateCrumple(els, centers, target) {
  els.forEach((el, i) => {
    const c = centers[i], dx = target.x - c.x, dy = target.y - c.y, r = el.getBoundingClientRect();
    const rot = (Math.random() - 0.5) * 320, sk = (Math.random() - 0.5) * 30;
    el.style.transformOrigin = `${c.x - r.left}px ${c.y - r.top}px`;
    el.animate([
      { transform: 'none' },
      { transform: `translate(${-dx * 0.05}px, ${-dy * 0.05 - 5}px) scale(1.08) rotate(${rot * 0.03}deg)`, offset: 0.22 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(0.7, 0.55) skew(${sk}deg, ${-sk * 0.6}deg) rotate(${rot * 0.5}deg)`, offset: 0.66 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.1) skew(${-sk}deg, ${sk * 0.4}deg) rotate(${rot}deg)`, opacity: 0.6 },
    ], { duration: 540, delay: i * 16, easing: 'cubic-bezier(.5,.02,.78,.42)', fill: 'forwards' });
    el.querySelector('.label').animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration: 540, delay: i * 16, fill: 'forwards' });
  });
  return 560 + els.length * 16;
}

// Icons fly from a point back to where they belong.
export function animateRestore(els, centers, from) {
  els.forEach((el, i) => {
    const c = centers[i], dx = from.x - c.x, dy = from.y - c.y, r = el.getBoundingClientRect();
    el.style.transformOrigin = `${c.x - r.left}px ${c.y - r.top}px`;
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(0.12) rotate(${(Math.random() - 0.5) * 200}deg)`, opacity: 0.4 },
      { transform: 'translate(0,0) scale(1.06)', opacity: 1, offset: 0.8 },
      { transform: 'none', opacity: 1 },
    ], { duration: 620, delay: i * 22, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'backwards' });
  });
  return 620 + els.length * 22;
}

export class Desktop {
  constructor(root, files, { onCrumple }) {
    this.root = root;
    this.files = files;
    this.onCrumple = onCrumple;
    this.sel = new Set();
    this.band = document.createElement('div');
    this.band.className = 'band';
    root.appendChild(this.band);
    this.menu = document.getElementById('ctxmenu');
    for (const f of files) this.mount(f);
    this.layout();
    this.bind();
  }

  mount(f) {
    f.el = iconEl(f.name, ICON_URL[f.type]);
    f.hidden = false;
    this.root.appendChild(f.el);
  }

  scale() { return Math.max(0.62, Math.min(1.1, innerWidth / 1512)); }

  pos(f) {
    const h = innerHeight - MENU_H;
    return { x: f.fx * innerWidth, y: MENU_H + f.fy * h };
  }

  layout() {
    document.documentElement.style.setProperty('--s', this.scale());
    for (const f of this.files) {
      const { x, y } = this.pos(f);
      f.el.style.left = `${x}px`;
      f.el.style.top = `${y}px`;
    }
  }

  visible() { return this.files.filter((f) => !f.hidden); }

  center(f) {
    const r = f.el.querySelector('.img').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  setSel(set) {
    this.sel = set;
    for (const f of this.files) f.el.classList.toggle('sel', set.has(f));
  }

  selected() { return [...this.sel].filter((f) => !f.hidden); }

  iconAt(x, y) {
    const vis = this.visible();
    for (let i = vis.length - 1; i >= 0; i--) {
      const f = vis[i];
      for (const part of [f.el.querySelector('.img'), f.el.querySelector('span')]) {
        const r = part.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return f;
      }
    }
    return null;
  }

  bind() {
    const root = this.root;
    let drag = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.hideMenu();
      const f = this.iconAt(e.clientX, e.clientY);
      const add = e.shiftKey || e.metaKey;
      if (f) {
        if (add) { const s = new Set(this.sel); s.has(f) ? s.delete(f) : s.add(f); this.setSel(s); }
        else if (!this.sel.has(f)) this.setSel(new Set([f]));
        drag = { kind: 'move', x0: e.clientX, y0: e.clientY, moved: false, start: this.selected().map((g) => ({ g, fx: g.fx, fy: g.fy })) };
      } else {
        drag = { kind: 'band', x0: e.clientX, y0: e.clientY, base: add ? new Set(this.sel) : new Set() };
        if (!add) this.setSel(new Set());
      }
      root.setPointerCapture(e.pointerId);
    });
    root.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (drag.kind === 'band') {
        const x = Math.min(e.clientX, drag.x0), y = Math.min(e.clientY, drag.y0), w = Math.abs(dx), h = Math.abs(dy);
        Object.assign(this.band.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        const s = new Set(drag.base);
        for (const f of this.visible()) {
          const hit = [f.el.querySelector('.img'), f.el.querySelector('span')].some((p) => {
            const r = p.getBoundingClientRect();
            return r.right > x && r.left < x + w && r.bottom > y && r.top < y + h;
          });
          if (hit) s.add(f);
        }
        this.setSel(s);
      } else {
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        const H = innerHeight - MENU_H;
        for (const { g, fx, fy } of drag.start) { g.fx = fx + dx / innerWidth; g.fy = fy + dy / H; }
        this.layout();
      }
    });
    const end = () => { drag = null; this.band.style.display = 'none'; };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);

    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const f = this.iconAt(e.clientX, e.clientY);
      if (f && !this.sel.has(f)) this.setSel(new Set([f]));
      this.showMenu(e.clientX, e.clientY);
    });

    // trackpad pinch arrives as ctrl+wheel in Chromium; Safari sends gesture events
    let acc = 0, accT = 0;
    addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const now = performance.now();
      if (now - accT > 350) acc = 0;
      accT = now;
      acc += e.deltaY;
      if (acc > 22 && this.selected().length) { acc = -1e9; this.crumple(); }
    }, { passive: false });
    addEventListener('gesturestart', (e) => e.preventDefault());
    addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (e.scale < 0.78 && this.selected().length) this.crumple();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.setSel(new Set()); this.hideMenu(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); this.setSel(new Set(this.visible())); }
    });
  }

  showMenu(x, y) {
    const n = this.selected().length;
    this.menu.innerHTML = '';
    const item = (label, fn, disabled) => {
      const d = document.createElement('div');
      d.className = 'mi' + (disabled ? ' off' : '');
      d.textContent = label;
      if (!disabled) d.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.hideMenu(); fn(); });
      this.menu.appendChild(d);
    };
    item(n ? `揉成纸团（${n} 个文件）` : '揉成纸团', () => this.crumple(), !n);
    item('全选', () => this.setSel(new Set(this.visible())));
    Object.assign(this.menu.style, { display: 'block', left: `${Math.min(x, innerWidth - 220)}px`, top: `${y}px` });
  }

  hideMenu() { this.menu.style.display = 'none'; }

  crumple() {
    const files = this.selected();
    if (!files.length || this.busy) return;
    this.busy = true;
    const pts = files.map((f) => this.center(f));
    const target = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    this.setSel(new Set());
    const ms = animateCrumple(files.map((f) => f.el), pts, target);
    this.onCrumple(files, target);
    setTimeout(() => {
      for (const f of files) { f.hidden = true; f.el.style.display = 'none'; f.el.getAnimations({ subtree: true }).forEach((a) => a.cancel()); }
      this.busy = false;
    }, ms);
    return { files, target };
  }

  restore(files, from) {
    for (const f of files) { f.hidden = false; f.el.style.display = ''; }
    animateRestore(files.map((f) => f.el), files.map((f) => this.center(f)), from);
  }
}
