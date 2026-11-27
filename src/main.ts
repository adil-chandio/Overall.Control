import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CHAPTERS, DURATION, chapterIndexAt } from "./chapters";
import { buildWorld } from "./world";

/* ================= RENDERER / SCENE / CAMERA ================= */
const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020610);
scene.fog = new THREE.FogExp2(0x03101f, 0.0016);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2500);
camera.position.set(0, 6, 60);

const world = buildWorld();
scene.add(world.group);

/* ================= POST-PROCESSING (OutputPass included — no black frame) ================= */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.6, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass()); // ACES + sRGB encode

/* ================= AUDIO (non-blocking, WebAudio synth) ================= */
let audioCtx: AudioContext | null = null;
let muted = false;
let droneNodes: OscillatorNode[] = [];
function startAudio() {
  if (audioCtx || muted) return;
  try {
    audioCtx = new AudioContext();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.12;
    gain.connect(audioCtx.destination);
    [55, 55.5, 110.3].forEach((f) => {
      const o = audioCtx!.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      droneNodes.push(o);
    });
    // low rumble LFO
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
  } catch {
    audioCtx = null; // audio is optional — never block the experience
  }
}

/* ================= UI ================= */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const titleScreen = $("title-screen"), hud = $("hud"), captionEl = $("caption");
const controls = $("controls"), chapterLabel = $("chapter-label"), badge = $("badge");
const endCard = $("end-card");

let lang: "ur" | "en" = "ur";
let ccOn = true;
let playing = false;
let simTime = 0;
let lastChapter = -1;
let captionedIdx = -1;

$("start-btn").addEventListener("click", () => {
  startAudio();
  titleScreen.classList.add("fade");
  setTimeout(() => titleScreen.classList.add("hidden"), 1300);
  hud.classList.remove("hidden");
  controls.classList.remove("hidden");
  playing = true;
  simTime = 0;
});
$("replay-btn").addEventListener("click", () => {
  endCard.classList.add("hidden");
  hud.classList.remove("hidden");
  controls.classList.remove("hidden");
  playing = true;
  simTime = 0;
  lastChapter = -1;
  chapterLabel.classList.add("hidden");
});
$("skip-btn").addEventListener("click", () => {
  const ci = chapterIndexAt(simTime);
  simTime = CHAPTERS[Math.min(ci + 1, CHAPTERS.length - 1)].start;
  lastChapter = -1;
});
$("lang-btn").addEventListener("click", () => {
  lang = lang === "ur" ? "en" : "ur";
  $("lang-btn").textContent = lang === "ur" ? "UR | EN" : "EN | UR";
});
$("mute-btn").addEventListener("click", () => {
  muted = !muted;
  $("mute-btn").textContent = muted ? "🔇 Muted" : "🔊 Sound";
  if (audioCtx) muted ? audioCtx.suspend() : audioCtx.resume();
  if (!muted) startAudio();
});
$("cc-btn").addEventListener("click", () => {
  ccOn = !ccOn;
  $("cc-btn").textContent = ccOn ? "CC: ON" : "CC: OFF";
});
window.addEventListener("pointerdown", () => audioCtx?.resume(), { once: true });

/* ================= CAMERA SCRIPT PER CHAPTER ================= */
function cameraPose(t: number, ci: number, ct: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (ci) {
    case 0: { // night sea — moonlit surface
      const z = 60 - ct * 1.5;
      return { pos: P(Math.sin(t * 0.2) * 4, 6 + Math.sin(t * 0.5) * 0.5, z), look: P(14, 1, -30) };
    }
    case 1: { // the dive — straight down
      const depth = ct / 16;
      return { pos: P(0, 6 - depth * 180, 55 - depth * 40), look: P(0, 6 - depth * 180 - 20, 0) };
    }
    case 2: { // pressure — HUD depth feel, slow drift
      const d = 220 + ct * 10;
      return { pos: P(Math.sin(t * 0.3) * 6, -d, 40 + ct), look: P(0, -d - 5, -20) };
    }
    case 3: { // anglerfish — track the strike
      const d = 420;
      return { pos: P(-10 + ct * 1.2, -d + 4, -55), look: P(10 + ct * 2, -d, -80) };
    }
    case 4: { // whale — wide shot
      return { pos: P(0, -700, -120), look: P(whaleX(ct), -700, -200) };
    }
    case 5: { // abyss — bioluminescence field
      const d = 1050 + Math.sin(t * 0.15) * 10;
      return { pos: P(Math.sin(t * 0.2) * 10, -d, -40), look: P(0, -d - 10, -120) };
    }
    default: { // jwalamukhi — fly toward the volcano
      const vt = THREE.MathUtils.clamp(ct / 20, 0, 1);
      return { pos: P(0, THREE.MathUtils.lerp(-1050, -2230, vt), THREE.MathUtils.lerp(-60, -160, vt)), look: P(0, -2270, -260) };
    }
  }
}
function whaleX(ct: number) {
  return THREE.MathUtils.lerp(160, -160, THREE.MathUtils.clamp(ct / 18, 0, 1));
}

/* ================= MAIN LOOP (manual delta — no THREE.Clock) ================= */
let prev = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const rawDt = Math.min((now - prev) / 1000, 0.1); // clamp — no sim explosion
  prev = now;

  if (playing) {
    const ci = chapterIndexAt(simTime);
    const chapter = CHAPTERS[ci];
    const ct = simTime - chapter.start;
    const slowmo = ci === 3 && ct >= 9 && ct <= 13;
    const dt = rawDt * (slowmo ? 0.25 : 1);
    simTime += dt;

    // camera
    const pose = cameraPose(simTime, ci, ct);
    camera.position.lerp(pose.pos, 1 - Math.pow(0.001, rawDt));
    camera.lookAt(pose.look);

    // world
    world.update(simTime, dt, ci, ct, slowmo, camera.position);
    world.setDepthHaze(Math.max(0, -camera.position.y));

    // chapter label
    if (ci !== lastChapter) {
      lastChapter = ci;
      chapterLabel.textContent = chapter.label;
      chapterLabel.classList.remove("hidden");
      captionedIdx = -1;
    }

    // captions
    if (ccOn) {
      let cap = null;
      for (let i = 0; i < chapter.captions.length; i++) {
        if (ct >= chapter.captions[i].t) cap = chapter.captions[i];
      }
      if (cap) {
        captionEl.textContent = lang === "ur" ? cap.ur : cap.en;
        captionEl.classList.add("show");
      } else captionEl.classList.remove("show");
    } else captionEl.classList.remove("show");

    // slow-mo badge
    badge.classList.toggle("show", slowmo);

    // end?
    if (simTime >= DURATION) {
      playing = false;
      hud.classList.add("hidden");
      controls.classList.add("hidden");
      badge.classList.remove("show");
      endCard.classList.remove("hidden");
    }
  }

  composer.render();
}
requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
