// GEHRAI — pure-Node software 3D renderer (no browser needed).
// Renders the cinematic frame-by-frame to PPM images, then ffmpeg assembles the MP4.
import fs from "node:fs";

/* ================= CONFIG ================= */
const W = 960, H = 540, FPS = 24;
const CHAPTERS = [
  { start: 0, dur: 16 }, { start: 16, dur: 16 }, { start: 32, dur: 16 },
  { start: 48, dur: 18 }, { start: 66, dur: 20 }, { start: 86, dur: 18 }, { start: 104, dur: 22 },
];
const DURATION = 126;
const OUT_DIR = "render/frames";
const ONLY = process.argv[2] ? parseFloat(process.argv[2]) : null; // debug single time

/* ================= MATH ================= */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
function v3(x = 0, y = 0, z = 0) { return { x, y, z }; }
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v3(a.x / l, a.y / l, a.z / l); };

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}
function lookAt(eye, target, up) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x.x, y.x, z.x, 0,
    x.y, y.y, z.y, 0,
    x.z, y.z, z.z, 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}
function mul(a, b) { // a*b, column-major
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function xform(m, p) {
  return v3(
    m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]
  );
}
function identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
function translate(x, y, z) { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; }
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); }
function scl(x, y, z) { const m = identity(); m[0] = x; m[5] = y; m[10] = z; return m; }

/* ================= GEOMETRY ================= */
function sphere(r, ws, hs) {
  const pos = [], idx = [];
  for (let i = 0; i <= hs; i++) {
    const ph = (i / hs) * Math.PI;
    for (let j = 0; j <= ws; j++) {
      const th = (j / ws) * Math.PI * 2;
      pos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
    }
  }
  for (let i = 0; i < hs; i++) for (let j = 0; j < ws; j++) {
    const a = i * (ws + 1) + j, b = a + ws + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { pos: new Float32Array(pos), idx };
}
function cone(r, h, seg) {
  const pos = [0, h / 2, 0], idx = [];
  for (let j = 0; j <= seg; j++) {
    const th = (j / seg) * Math.PI * 2;
    pos.push(r * Math.cos(th), -h / 2, r * Math.sin(th));
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + j + 1, 1 + j);
  const base = pos.length / 3;
  pos.push(0, -h / 2, 0);
  for (let j = 0; j < seg; j++) idx.push(base, 1 + j, 1 + j + 1);
  return { pos: new Float32Array(pos), idx };
}
function cylinder(r, h, seg) {
  const pos = [], idx = [];
  for (let j = 0; j <= seg; j++) {
    const th = (j / seg) * Math.PI * 2;
    pos.push(r * Math.cos(th), h / 2, r * Math.sin(th), r * Math.cos(th), -h / 2, r * Math.sin(th));
  }
  for (let j = 0; j < seg; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return { pos: new Float32Array(pos), idx };
}
function plane(w, h, seg) { // XZ plane
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg; j++) {
    pos.push((j / seg - 0.5) * w, 0, (i / seg - 0.5) * h);
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j;
    idx.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
  }
  return { pos: new Float32Array(pos), idx };
}

/* ================= SCENE ================= */
const MOON_DIR = norm(v3(0.45, 0.55, -0.7));

function makeStars() {
  const dirs = [];
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const v = norm(v3(rnd() * 2 - 1, rnd() * 0.95 + 0.05, rnd() * 2 - 1));
    dirs.push(v);
  }
  return dirs;
}
const STARS = makeStars();

function makeParticles(count, yBase, spread, seedOff) {
  let seed = 1234 + seedOff;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const p = [];
  for (let i = 0; i < count; i++) p.push(v3((rnd() - 0.5) * spread, yBase + rnd() * spread * 0.5, (rnd() - 0.5) * spread));
  return p;
}
const BUBBLES = makeParticles(220, -160, 120, 1);
const BIO = makeParticles(420, -1050, 260, 2);
const EMBERS = makeParticles(320, -2320, 90, 3);

function chapterIndexAt(t) {
  const c = clamp(t, 0, DURATION - 1e-4);
  for (let i = CHAPTERS.length - 1; i >= 0; i--) if (c >= CHAPTERS[i].start) return i;
  return 0;
}

function cameraPose(t, ci, ct) {
  const P = v3;
  switch (ci) {
    case 0: return { pos: P(Math.sin(t * 0.2) * 4, 6 + Math.sin(t * 0.5) * 0.5, 60 - ct * 1.5), look: P(14, 26, -60) };
    case 1: { const d = ct / 16; return { pos: P(0, 6 - d * 180, 55 - d * 40), look: P(0, 6 - d * 180 - 20, 0) }; }
    case 2: { const d = 220 + ct * 10; return { pos: P(Math.sin(t * 0.3) * 6, -d, 40 + ct), look: P(0, -d - 5, -20) }; }
    case 3: { const d = 420; const st = clamp((ct - 6) / 6, 0, 1); const fx = lerp(-60, 70, st); return { pos: P(fx - 22, -d + 4 + Math.sin(st * Math.PI) * 10, -52), look: P(fx, -d + Math.sin(st * Math.PI) * 30, -80) }; }
    case 4: return { pos: P(0, -700, -120), look: P(whaleX(ct), -700, -200) };
    case 5: { const d = 1050 + Math.sin(t * 0.15) * 10; return { pos: P(Math.sin(t * 0.2) * 10, -d, -40), look: P(0, -d - 10, -120) }; }
    default: { const vt = clamp(ct / 20, 0, 1); return { pos: P(0, lerp(-1050, -2230, vt), lerp(-60, -160, vt)), look: P(0, -2270, -260) }; }
  }
}
function whaleX(ct) { return lerp(160, -160, clamp(ct / 18, 0, 1)); }

/* ================= RASTERIZER ================= */
const fb = new Uint8Array(W * H * 3);
const zb = new Float32Array(W * H);

function clear(r, g, b) { fb.fill(0); for (let i = 0; i < W * H; i++) { fb[i * 3] = r; fb[i * 3 + 1] = g; fb[i * 3 + 2] = b; zb[i] = Infinity; } }

function drawSky(camPos, view, proj, depth) {
  // vertical gradient + moon glow, based on inverse-projected ray direction approx via screen y
  const d = clamp(depth / 2300, 0, 1);
  for (let y = 0; y < H; y++) {
    const h = 1 - y / H; // 1 top
    let r, g, b;
    if (d < 0.5) {
      const k = d * 2;
      r = lerp(26, 1, k) * (0.4 + 0.6 * h) + 8 * h;
      g = lerp(56, 3, k) * (0.4 + 0.6 * h) + 16 * h;
      b = lerp(107, 8, k) * (0.4 + 0.6 * h) + 30 * h;
    } else {
      const k = (d - 0.5) * 2;
      r = lerp(1, 1, k); g = lerp(3, 2, k); b = lerp(8, 6, k);
    }
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      fb[i] = clamp(r, 0, 255); fb[i + 1] = clamp(g, 0, 255); fb[i + 2] = clamp(b, 0, 255);
    }
  }
  // moon: project moon position
  if (d < 0.25) {
    const mp = add(camPos, scale(MOON_DIR, 800));
    const s = project(mp, view, proj);
    if (s) {
      const glow = (1 - d) * 255;
      sprite(s.x, s.y, 60, 1.0, [glow, glow, glow * 1.02], true);
      sprite(s.x, s.y, 16, 1.0, [255, 252, 240], true);
    }
    // stars
    const alpha = (1 - d);
    for (const sd of STARS) {
      const p = add(camPos, scale(sd, 850));
      const sp = project(p, view, proj);
      if (sp && sp.z > 0) {
        const tw = 0.5 + 0.5 * Math.sin(sp.x * 0.7 + sp.y * 1.3);
        sprite(sp.x, sp.y, 1.6, alpha * tw, [200, 220, 255], true);
      }
    }
  }
}

function project(p, view, proj) {
  const v = xform(view, p);
  if (v.z > -0.5) return null;
  const c = xform(proj, v);
  const w = -v.z;
  if (w <= 0.01) return null;
  return { x: (c.x / w * 0.5 + 0.5) * W, y: (1 - (c.y / w * 0.5 + 0.5)) * H, z: v.z };
}

function sprite(cx, cy, radius, alpha, col, additive) {
  const r = Math.ceil(radius);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d2 = (x * x + y * y) / (radius * radius);
    if (d2 > 1) continue;
    const px = Math.round(cx + x), py = Math.round(cy + y);
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    const i = py * W + px;
    const fall = Math.max(0, 1 - d2);
    const a = alpha * fall * fall;
    const o = i * 3;
    if (additive) {
      fb[o] = clamp(fb[o] + col[0] * a, 0, 255);
      fb[o + 1] = clamp(fb[o + 1] + col[1] * a, 0, 255);
      fb[o + 2] = clamp(fb[o + 2] + col[2] * a, 0, 255);
    } else {
      fb[o] = clamp(fb[o] * (1 - a) + col[0] * a, 0, 255);
      fb[o + 1] = clamp(fb[o + 1] * (1 - a) + col[1] * a, 0, 255);
      fb[o + 2] = clamp(fb[o + 2] * (1 - a) + col[2] * a, 0, 255);
    }
  }
}

// draw mesh: geo {pos, idx}, model matrix, color, emissive, opts
function drawMesh(geo, model, view, proj, color, emissive = 0, opts = {}) {
  const n = geo.pos.length / 3;
  const world = new Array(n), viewP = new Array(n), scr = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = v3(geo.pos[i * 3], geo.pos[i * 3 + 1], geo.pos[i * 3 + 2]);
    const w = xform(model, p);
    world[i] = w;
    const v = xform(view, w);
    viewP[i] = v;
    scr[i] = v.z < -0.05 ? project(w, view, proj) : null;
  }
  const fogCol = opts.fogCol || [3, 12, 26];
  const fogK = opts.fogK ?? 0.0016;
  const idx = geo.idx;
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    if (!scr[a] || !scr[b] || !scr[c]) continue;
    // backface cull in screen space
    const area = (scr[b].x - scr[a].x) * (scr[c].y - scr[a].y) - (scr[c].x - scr[a].x) * (scr[b].y - scr[a].y);
    if (area <= 0) continue;
    // face normal (world)
    const fn = norm(cross(sub(world[b], world[a]), sub(world[c], world[a])));
    let lambert = Math.max(0, dot(fn, MOON_DIR));
    if (opts.doubleSide) lambert = Math.abs(lambert);
    const light = 0.25 + 0.75 * lambert;
    const depth = -(viewP[a].z + viewP[b].z + viewP[c].z) / 3;
    const fog = 1 - Math.exp(-fogK * Math.max(0, depth) * Math.max(0, depth) * 0.02);
    let r = (color[0] * light * (opts.lightScale ?? 1) + color[0] * emissive) * (1 - fog) + fogCol[0] * fog;
    let g = (color[1] * light * (opts.lightScale ?? 1) + color[1] * emissive) * (1 - fog) + fogCol[1] * fog;
    let bl = (color[2] * light * (opts.lightScale ?? 1) + color[2] * emissive) * (1 - fog) + fogCol[2] * fog;
    if (opts.waterGlint) { // moon glint on water
      const glint = Math.pow(Math.max(0, dot(fn, MOON_DIR)), 24) * 160;
      r += glint; g += glint * 1.05; bl += glint * 1.2;
    }
    if (opts.emissiveColor) { r = opts.emissiveColor[0]; g = opts.emissiveColor[1]; bl = opts.emissiveColor[2]; }
    // bbox
    const minX = Math.max(0, Math.floor(Math.min(scr[a].x, scr[b].x, scr[c].x)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(scr[a].x, scr[b].x, scr[c].x)));
    const minY = Math.max(0, Math.floor(Math.min(scr[a].y, scr[b].y, scr[c].y)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(scr[a].y, scr[b].y, scr[c].y)));
    const d = (scr[b].x - scr[a].x) * (scr[c].y - scr[a].y) - (scr[c].x - scr[a].x) * (scr[b].y - scr[a].y);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((scr[b].x - x) * (scr[c].y - y) - (scr[c].x - x) * (scr[b].y - y)) / d;
      const w1 = ((scr[c].x - x) * (scr[a].y - y) - (scr[a].x - x) * (scr[c].y - y)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * (-viewP[a].z) + w1 * (-viewP[b].z) + w2 * (-viewP[c].z);
      const i = y * W + x;
      if (z < zb[i]) {
        zb[i] = z;
        const o = i * 3;
        fb[o] = clamp(r, 0, 255); fb[o + 1] = clamp(g, 0, 255); fb[o + 2] = clamp(bl, 0, 255);
      }
    }
  }
}

function drawPoints(points, view, proj, size, col, alpha, camPos) {
  for (const p of points) {
    const s = project(p, view, proj);
    if (s && s.z > 0) sprite(s.x, s.y, size, alpha, col, true);
  }
}

/* ================= FRAME ================= */
function renderFrame(t) {
  const ci = chapterIndexAt(t);
  const ct = t - CHAPTERS[ci].start;
  const slowmo = ci === 3 && ct >= 9 && ct <= 13;
  const dt = (1 / FPS) * (slowmo ? 0.25 : 1);

  const pose = cameraPose(t, ci, ct);
  const view = lookAt(pose.pos, pose.look, v3(0, 1, 0));
  const proj = perspective((60 * Math.PI) / 180, W / H, 0.1, 2500);
  const depth = Math.max(0, -pose.pos.y);

  clear(2, 6, 16);
  drawSky(pose.pos, view, proj, depth);

  const d = clamp(depth / 2300, 0, 1);
  const lightScale = 1 - d * 0.75;

  // water (animated grid)
  const waterGeo = plane(1800, 1800, 40);
  for (let i = 0; i < waterGeo.pos.length / 3; i++) {
    const x = waterGeo.pos[i * 3], z = waterGeo.pos[i * 3 + 2];
    waterGeo.pos[i * 3 + 1] = Math.sin(x * 0.05 + t * 1.2) * 0.6 + Math.sin(z * 0.043 + t * 0.9) * 0.6;
  }
  const deepCol = d < 0.5 ? [4 + 30 * (1 - d * 2), 26 + 40 * (1 - d * 2), 56 + 60 * (1 - d * 2)] : [1, 3, 8];
  drawMesh(waterGeo, identity(), view, proj, deepCol, 0, { doubleSide: true, waterGlint: true, lightScale: 0.6 + 0.4 * (1 - d), fogK: 0.0009 });

  // boat (chapter 0 only)
  if (ci === 0) {
    const bob = Math.sin(t * 1.1) * 0.35;
    const boatM = mul(translate(14, 0.6 + bob, -30), mul(rotZ(Math.sin(t * 0.7) * 0.06), identity()));
    drawMesh(cone(3.2, 12, 4), mul(boatM, mul(rotY(Math.PI / 4), mul(rotX(Math.PI / 2), scl(1, 0.35, 0.45)))), view, proj, [42, 28, 16], 0, { lightScale });
    drawMesh(cylinder(0.12, 7, 6), mul(boatM, translate(0, 3.2, 0)), view, proj, [42, 28, 16], 0, { lightScale });
    drawMesh(cone(2.2, 5, 4), mul(boatM, mul(translate(0, 3.4, 0.4), mul(rotX(Math.PI / 2), scl(1, 1, 0.25)))), view, proj, [216, 205, 180], 0, { doubleSide: true, lightScale });
  }

  // particles
  if (ci >= 1) {
    const bp = BUBBLES.map((p) => v3(p.x, p.y + ((t * 6) % 140), p.z));
    drawPoints(bp, view, proj, 1.6, [159, 212, 255], 0.5, pose.pos);
  }
  // marine snow drifting around the camera in deep chapters
  if (ci >= 2 && ci <= 5) {
    const snow = [];
    let seed = 777 + Math.floor(t * 2);
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 160; i++) {
      snow.push(v3(pose.pos.x + (rnd() - 0.5) * 160, pose.pos.y + (rnd() - 0.5) * 100, pose.pos.z + (rnd() - 0.5) * 160 - 40));
    }
    drawPoints(snow, view, proj, 1.6, [160, 200, 240], 0.55 + 0.2 * d, pose.pos);
  }
  if (ci === 2 || ci === 3) {
    const mp = BIO.slice(0, 150).map((p) => v3(p.x, p.y + Math.sin(t * 0.5 + p.x) * 5, p.z));
    drawPoints(mp, view, proj, 1.8, [102, 255, 224], 0.4 + 0.3 * Math.sin(t * 2.1), pose.pos);
  }
  if (ci === 5) {
    const tw = 0.45 + 0.35 * Math.sin(t * 2.1);
    drawPoints(BIO, view, proj, 2.4, [102, 255, 224], tw, pose.pos);
  }
  if (ci === 6) {
    const ep = EMBERS.map((p) => v3(p.x + Math.sin(t * 3 + p.z) * 2, -2320 + ((t * 40 + p.y + 2320) % 60), p.z));
    drawPoints(ep, view, proj, 2.0, [255, 120, 50], 0.7, pose.pos);
  }

  // anglerfish (chapter 3)
  if (ci === 3) {
    if (process.env.DEBUG) {
      const st0 = clamp((ct - 6) / 6, 0, 1);
      const fx = lerp(-60, 70, st0), fy = -420 + Math.sin(st0 * Math.PI) * 30;
      const fs = project(v3(fx, fy, -80), view, proj);
      let snowVis = 0;
      let seed = 777 + Math.floor(t * 2);
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 160; i++) {
        const sp = project(v3(pose.pos.x + (rnd() - 0.5) * 160, pose.pos.y + (rnd() - 0.5) * 100, pose.pos.z + (rnd() - 0.5) * 160 - 40), view, proj);
        if (sp && sp.x >= 0 && sp.x < W && sp.y >= 0 && sp.y < H) snowVis++;
      }
      console.log(`DEBUG t=${t} ci=${ci} ct=${ct} cam=${JSON.stringify(pose.pos)} fishScreen=${JSON.stringify(fs)} snowVis=${snowVis}`);
    }
    const st = clamp((ct - 6) / 6, 0, 1);
    const afM = mul(translate(lerp(-60, 70, st), -420 + Math.sin(st * Math.PI) * 30, -80), rotY(-0.5 + st));
    drawMesh(sphere(3, 16, 10), mul(afM, scl(1.6, 1, 1)), view, proj, [26, 34, 51], 0.15, { lightScale });
    drawMesh(cone(1.6, 3.4, 10), mul(afM, mul(translate(3.4, -0.6, 0), rotZ(-Math.PI / 2.2))), view, proj, [13, 17, 25], 0, { lightScale });
    // lamp glow
    const lampW = xform(afM, v3(4.6, 1.4, 0));
    const ls = project(lampW, view, proj);
    if (ls) {
      const inten = slowmo ? 1.4 : 0.8;
      sprite(ls.x, ls.y, 26, 0.5 * inten, [174, 244, 255], true);
      sprite(ls.x, ls.y, 6, inten, [220, 250, 255], true);
    }
  }

  // whale (chapter 4)
  if (ci === 4) {
    const wt = clamp(ct / 18, 0, 1);
    const wM = mul(translate(whaleX(ct), -700 + Math.sin(wt * Math.PI) * 60, -200), rotY(wt < 0.5 ? 0.15 : -0.15));
    drawMesh(sphere(9, 20, 12), mul(wM, scl(4.5, 1.4, 1.3)), view, proj, [44, 74, 110], 0.35, { lightScale });
    drawMesh(cone(3.4, 7, 8), mul(wM, mul(translate(-38, 0, 0), mul(rotZ(Math.PI / 2), scl(1, 1, 0.25)))), view, proj, [44, 74, 110], 0.35, { lightScale });
  }

  // volcano (chapter 6)
  if (ci === 6) {
    drawMesh(cone(60, 160, 20), translate(0, -2270, 0), view, proj, [70, 45, 32], 0.25, { lightScale: 0.9 });
    // lava-lit upper cone
    drawMesh(cone(24, 70, 16), translate(0, -2165, 0), view, proj, [120, 50, 20], 0.8, { lightScale: 0.9 });
    const pulse = 0.8 + 0.2 * Math.sin(t * 4);
    const cs = project(v3(0, -2112, 0), view, proj);
    if (cs) {
      sprite(cs.x, cs.y, 40 * pulse, 0.9, [255, 90, 26], true);
      sprite(cs.x, cs.y, 18 * pulse, 1.0, [255, 200, 80], true);
    }
    const vs = project(v3(40, -2300, 30), view, proj);
    if (vs) sprite(vs.x, vs.y, 30, 0.5 * pulse, [255, 136, 51], true);
  }

  // vignette
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
    const v = Math.max(0, (Math.hypot(dx, dy) - 0.55) / 0.9) * 0.5;
    if (v > 0) {
      const o = (y * W + x) * 3;
      fb[o] *= 1 - v; fb[o + 1] *= 1 - v; fb[o + 2] *= 1 - v;
    }
  }
}

function writePPM(path) {
  const header = Buffer.from(`P6\n${W} ${H}\n255\n`);
  fs.writeFileSync(path, Buffer.concat([header, Buffer.from(fb.buffer)]));
}

/* ================= MAIN ================= */
fs.mkdirSync(OUT_DIR, { recursive: true });
const t0 = performance.now();
if (ONLY !== null) {
  renderFrame(ONLY);
  writePPM(`${OUT_DIR}/test-${ONLY}.ppm`);
  console.log(`test frame t=${ONLY} in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
  process.exit(0);
}
const total = Math.floor(DURATION * FPS);
for (let f = 0; f < total; f++) {
  renderFrame(f / FPS);
  writePPM(`${OUT_DIR}/f${String(f).padStart(5, "0")}.ppm`);
  if (f % 120 === 0) {
    const el = (performance.now() - t0) / 1000;
    console.log(`frame ${f}/${total}  ${(el / (f + 1) * (total - f - 1) / 60).toFixed(1)} min remaining`);
  }
}
console.log(`DONE ${total} frames in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
