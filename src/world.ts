import * as THREE from "three";

/* ---------- procedural soft round sprite for particles ---------- */
export function makeSoftDotTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface World {
  group: THREE.Group;
  update: (t: number, dt: number, chapter: number, ct: number, slowmo: boolean, camPos?: THREE.Vector3) => void;
  setDepthHaze: (depth: number) => void;
}

export function buildWorld(): World {
  const group = new THREE.Group();
  const dotTex = makeSoftDotTexture();

  /* ---------- SKY (big sphere, backside) ---------- */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uDeep: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uTime;
      uniform float uDeep; // 0 surface .. 1 abyss
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 surface = mix(vec3(0.02,0.06,0.14), vec3(0.10,0.22,0.42), smoothstep(-0.1, 0.6, h));
        vec3 deep = vec3(0.004,0.010,0.030);
        vec3 col = mix(surface, deep, uDeep);
        // moon glow in a fixed direction
        vec3 moonDir = normalize(vec3(0.45, 0.55, -0.7));
        float m = pow(max(dot(normalize(vDir), moonDir), 0.0), 220.0);
        col += vec3(0.9,0.95,1.0) * m * (1.0 - uDeep) * 1.4;
        float g = pow(max(dot(normalize(vDir), moonDir), 0.0), 8.0);
        col += vec3(0.25,0.35,0.55) * g * (1.0 - uDeep) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
  group.add(sky);

  /* ---------- STARS ---------- */
  const starCount = 1200;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection();
    v.y = Math.abs(v.y) * 0.9 + 0.05; // upper hemisphere
    v.multiplyScalar(850);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, map: dotTex, transparent: true, opacity: 0.9, color: 0xcfe0ff, depthWrite: false })
  );
  group.add(stars);

  /* ---------- MOON ---------- */
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(28, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xf4f7ff })
  );
  moon.position.set(0.45 * 800, 0.55 * 800, -0.7 * 800);
  group.add(moon);

  /* ---------- WATER (custom shader — correct matrices: projection * modelView) ---------- */
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0.45, 0.55, -0.7).normalize() },
      uDeep: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vec3 p = position;
        float w = sin(p.x * 0.05 + uTime * 1.2) * 0.6 + sin(p.z * 0.043 + uTime * 0.9) * 0.6;
        p.y += w;
        vWave = w;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world; // viewMatrix included — no inverted frame
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uMoonDir;
      uniform float uDeep;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vec3 deepCol = mix(vec3(0.015,0.10,0.22), vec3(0.002,0.012,0.045), uDeep);
        vec3 col = deepCol + vec3(0.02,0.05,0.09) * (0.5 + 0.5 * vWave);
        // moon glint path
        vec3 toMoon = normalize(uMoonDir);
        float glint = pow(max(dot(toMoon, vec3(0.0,1.0,0.0)), 0.0), 2.0);
        col += vec3(0.5,0.65,0.85) * glint * (1.0 - uDeep) * 0.35;
        gl_FragColor = vec4(col, 0.96);
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800, 96, 96), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  group.add(water);

  /* ---------- BOAT ---------- */
  const boat = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.8 });
  const hull = new THREE.Mesh(new THREE.ConeGeometry(3.2, 12, 4), hullMat);
  hull.rotation.x = Math.PI / 2;
  hull.rotation.y = Math.PI / 4;
  hull.scale.set(1, 0.35, 0.45);
  boat.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 6), hullMat);
  mast.position.y = 3.2;
  boat.add(mast);
  const sail = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 5, 4),
    new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.9, side: THREE.DoubleSide })
  );
  sail.position.set(0, 3.4, 0.4);
  sail.rotation.x = Math.PI / 2;
  sail.scale.z = 0.25;
  boat.add(sail);
  boat.position.set(14, 0.6, -30);
  group.add(boat);

  /* ---------- BUBBLES / PARTICLES ---------- */
  function makeParticles(count: number, color: number, size: number, spread: number, yBase: number): THREE.Points {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * spread;
      pos[i * 3 + 1] = yBase + Math.random() * spread * 0.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size, map: dotTex, transparent: true, opacity: 0.7, color, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    group.add(p);
    return p;
  }
  const bubbles = makeParticles(250, 0x9fd4ff, 1.6, 120, -160);
  const bio = makeParticles(500, 0x66ffe0, 2.4, 260, -1050);
  const embers = makeParticles(400, 0xff7733, 2.0, 90, -2280);

  /* ---------- ANGLERFISH ---------- */
  const angler = new THREE.Group();
  const fishMat = new THREE.MeshStandardMaterial({ color: 0x1a2233, roughness: 0.6, emissive: 0x0a0f1a });
  const body = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 14), fishMat);
  body.scale.set(1.6, 1, 1);
  angler.add(body);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.4, 12), new THREE.MeshStandardMaterial({ color: 0x0d1119, roughness: 0.4 }));
  jaw.rotation.z = -Math.PI / 2.2;
  jaw.position.set(3.4, -0.6, 0);
  angler.add(jaw);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xaef4ff });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), lampMat);
  lamp.position.set(4.6, 1.4, 0);
  angler.add(lamp);
  const lampLight = new THREE.PointLight(0xaef4ff, 60, 60);
  lampLight.position.copy(lamp.position);
  angler.add(lampLight);
  angler.position.set(-60, -420, -80);
  angler.visible = false;
  group.add(angler);

  /* ---------- WHALE ---------- */
  const whale = new THREE.Group();
  const whaleMat = new THREE.MeshStandardMaterial({ color: 0x2c4a6e, roughness: 0.55, emissive: 0x0a1a2e, emissiveIntensity: 0.6 });
  const wbody = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), whaleMat);
  wbody.scale.set(4.5, 1.4, 1.3);
  whale.add(wbody);
  const wtail = new THREE.Mesh(new THREE.ConeGeometry(3.4, 7, 8), whaleMat);
  wtail.rotation.z = Math.PI / 2;
  wtail.scale.set(1, 1, 0.25);
  wtail.position.x = -38;
  whale.add(wtail);
  const bellyGlow = new THREE.PointLight(0x4d7fb8, 40, 120);
  bellyGlow.position.set(0, -6, 0);
  whale.add(bellyGlow);
  whale.position.set(150, -700, -200);
  whale.visible = false;
  group.add(whale);

  /* ---------- VOLCANO ---------- */
  const volcano = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(60, 160, 24), rockMat);
  cone.position.y = -2350 + 80;
  volcano.add(cone);
  const craterGlow = new THREE.Mesh(
    new THREE.CircleGeometry(26, 24),
    new THREE.MeshBasicMaterial({ color: 0xff5a1a })
  );
  craterGlow.rotation.x = -Math.PI / 2;
  craterGlow.position.y = -2350 + 158;
  volcano.add(craterGlow);
  const lavaLight = new THREE.PointLight(0xff5a1a, 900, 500);
  lavaLight.position.y = -2350 + 165;
  volcano.add(lavaLight);
  const ventLight = new THREE.PointLight(0xff8833, 300, 250);
  ventLight.position.set(40, -2300, 30);
  volcano.add(ventLight);
  volcano.visible = false;
  group.add(volcano);

  /* ---------- LIGHTS ---------- */
  const moonLight = new THREE.DirectionalLight(0xbfd8ff, 1.6);
  moonLight.position.set(0.45 * 100, 0.55 * 100, -0.7 * 100);
  group.add(moonLight);
  const fill = new THREE.AmbientLight(0x223349, 1.2);
  group.add(fill);
  const camLight = new THREE.PointLight(0x88aacc, 0, 200); // camera-follow fill for deep scenes
  group.add(camLight);

  /* ---------- PER-FRAME UPDATE ---------- */
  function update(t: number, dt: number, chapter: number, ct: number, slowmo: boolean, camPos?: THREE.Vector3) {
    skyMat.uniforms.uTime.value = t;
    waterMat.uniforms.uTime.value = t;
    boat.position.y = 0.6 + Math.sin(t * 1.1) * 0.35;
    boat.rotation.z = Math.sin(t * 0.7) * 0.06;

    // bubbles drift up
    const bp = bubbles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      let y = bp.getY(i) + dt * (slowmo ? 1.2 : 6);
      if (y > -20) y = -160;
      bp.setY(i, y);
    }
    bp.needsUpdate = true;

    // bioluminescence twinkle
    const mp = bio.material as THREE.PointsMaterial;
    mp.opacity = 0.45 + 0.35 * Math.sin(t * 2.1);

    // embers rise
    const ep = embers.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ep.count; i++) {
      let y = ep.getY(i) + dt * (slowmo ? 8 : 40);
      if (y > -2260) y = -2320;
      ep.setY(i, y);
      ep.setX(i, ep.getX(i) + Math.sin(t * 3 + i) * dt * 2);
    }
    ep.needsUpdate = true;

    // anglerfish strike (chapter 3, 0-based): swims across mid-chapter, slow-mo window at ct 9..13
    if (chapter === 3) {
      angler.visible = true;
      const strikeT = THREE.MathUtils.clamp((ct - 6) / 6, 0, 1); // 0..1 across ct 6..12
      angler.position.x = THREE.MathUtils.lerp(-60, 70, strikeT);
      angler.position.y = -420 + Math.sin(strikeT * Math.PI) * 30;
      angler.rotation.y = -0.5 + strikeT * 1.0;
      lampLight.intensity = slowmo ? 140 : 60;
    } else {
      angler.visible = false;
    }

    // whale crossing (chapter 4, 0-based)
    if (chapter === 4) {
      whale.visible = true;
      const wt = THREE.MathUtils.clamp(ct / 18, 0, 1);
      whale.position.x = THREE.MathUtils.lerp(160, -160, wt);
      whale.position.y = -700 + Math.sin(wt * Math.PI) * 60;
      whale.rotation.y = wt < 0.5 ? 0.15 : -0.15;
    } else {
      whale.visible = false;
    }

    // volcano (chapter 6, 0-based)
    volcano.visible = chapter === 6;
    if (volcano.visible) {
      const pulse = 0.8 + 0.2 * Math.sin(t * 4);
      lavaLight.intensity = 900 * pulse;
      craterGlow.scale.setScalar(pulse);
    }

    if (camPos) camLight.position.copy(camPos);
    camLight.intensity = chapter >= 2 ? 30 : 0;
  }

  function setDepthHaze(depth: number) {
    const d = Math.min(Math.max(depth / 2300, 0), 1);
    skyMat.uniforms.uDeep.value = d;
    waterMat.uniforms.uDeep.value = d;
    stars.material.opacity = 1 - d;
    moon.visible = d < 0.25;
    (stars.material as THREE.PointsMaterial).opacity = 1 - d;
    fill.intensity = 1.2 - d * 0.9;
  }

  return { group, update, setDepthHaze };
}
