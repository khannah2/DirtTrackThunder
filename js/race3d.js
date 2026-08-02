/**
 * Photo-real first-person dirt late model race — Three.js WebGL
 * Physics stay arcade on the oval; visuals are lit 3D night track + photo-skinned cars.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { PLAYER } from "./characters.js";
import { RaceAudio } from "./audio.js";

const TAU = Math.PI * 2;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function lerpAngle(a, b, t) {
  return a + normAngle(b - a) * t;
}
function formatTime(t) {
  if (t == null || !isFinite(t)) return "--:--.--";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Mutable track geometry — set per venue via applyTrackConfig() */
const TRACK = {
  cx: 0,
  cy: 0,
  outerRx: 95,
  outerRy: 58,
  innerRx: 52,
  innerRy: 24,
  collideOuter: 0.97,
  collideInner: 1.04,
  bank: 0.9,
  clay: "#c9a882",
  sky: "#0c101c",
  name: "Dirt Oval",
  location: "",
  signs: [],
};

function applyTrackConfig(cfg) {
  if (!cfg) return;
  TRACK.outerRx = cfg.outerRx ?? TRACK.outerRx;
  TRACK.outerRy = cfg.outerRy ?? TRACK.outerRy;
  TRACK.innerRx = cfg.innerRx ?? TRACK.innerRx;
  TRACK.innerRy = cfg.innerRy ?? TRACK.innerRy;
  TRACK.bank = cfg.bank ?? TRACK.bank;
  TRACK.clay = cfg.clay || TRACK.clay;
  TRACK.sky = cfg.sky || TRACK.sky;
  TRACK.name = cfg.name || TRACK.name;
  TRACK.location = cfg.location || "";
  TRACK.shortName = cfg.shortName || cfg.name;
  TRACK.signs = cfg.signs || [];
}

function laneZ(lane) {
  return lane * TRACK.bank;
}

function linePoint(progress, lane = 0.45) {
  const ang = Math.PI / 2 - progress;
  const rx = lerp(TRACK.innerRx, TRACK.outerRx, lane);
  const ry = lerp(TRACK.innerRy, TRACK.outerRy, lane);
  return {
    x: TRACK.cx + Math.cos(ang) * rx,
    y: TRACK.cy + Math.sin(ang) * ry,
    z: laneZ(lane),
  };
}

function lineHeading(progress) {
  const a = linePoint(progress, 0.45);
  const b = linePoint(progress + 0.04, 0.45);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function radial(x, y, rx, ry) {
  const dx = (x - TRACK.cx) / rx;
  const dy = (y - TRACK.cy) / ry;
  return Math.hypot(dx, dy);
}

function progressAt(x, y) {
  const ang = Math.atan2(y - TRACK.cy, x - TRACK.cx);
  let p = Math.PI / 2 - ang;
  while (p < 0) p += TAU;
  while (p >= TAU) p -= TAU;
  return p;
}

function onTrack(x, y) {
  return radial(x, y, TRACK.outerRx, TRACK.outerRy) <= 1 && radial(x, y, TRACK.innerRx, TRACK.innerRy) >= 1;
}

// ---------- Procedural textures ----------
function canvasTex(draw, w = 512, h = 512, opts = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  return t;
}

function makeDirtMaps() {
  const map = canvasTex((g, w, h) => {
    g.fillStyle = "#6a4328";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 28000; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const v = Math.random();
      g.fillStyle =
        v > 0.55
          ? `rgba(${100 + Math.random() * 50 | 0},${60 + Math.random() * 30 | 0},${30 | 0},${0.15 + Math.random() * 0.3})`
          : `rgba(30,15,8,${0.1 + Math.random() * 0.25})`;
      g.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
    }
    g.strokeStyle = "rgba(25,12,6,0.28)";
    g.lineWidth = 4;
    for (let y = 0; y < h; y += 18) {
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x < w; x += 10) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 3);
      g.stroke();
    }
  }, 1024, 1024, { repeat: [14, 4] });

  const normal = canvasTex((g, w, h) => {
    g.fillStyle = "#8080ff";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12000; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const n = 100 + Math.random() * 50;
      g.fillStyle = `rgb(${n | 0},${n | 0},${200 + Math.random() * 40 | 0})`;
      g.fillRect(x, y, 2, 2);
    }
  }, 512, 512, { repeat: [14, 4] });
  normal.colorSpace = THREE.NoColorSpace;

  const rough = canvasTex((g, w, h) => {
    for (let i = 0; i < w * h; i++) {
      const v = 140 + Math.random() * 80;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(i % w, (i / w) | 0, 1, 1);
    }
  }, 256, 256, { repeat: [14, 4] });
  rough.colorSpace = THREE.NoColorSpace;

  return { map, normal, rough };
}

function makeGrassMap() {
  return canvasTex((g, w, h) => {
    g.fillStyle = "#1e3a16";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8000; i++) {
      g.strokeStyle = `rgba(${15 + Math.random() * 40},${50 + Math.random() * 60},${10 + Math.random() * 20},0.45)`;
      const x = Math.random() * w;
      const y = Math.random() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 4, y - 5 - Math.random() * 8);
      g.stroke();
    }
  }, 512, 512, { repeat: [40, 40] });
}

/**
 * Ultra-readable trackside sign — high contrast, huge type, always legible at speed.
 * Prefer short lines; wraps long titles.
 */
function makeSponsorTexture(title, sub, tag, bg, accent) {
  const w = 2048;
  const h = 1024;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");

  const accentCol = accent || "#FFD200";
  const bgCol = bg || "#0a0a0a";

  // Solid fill
  g.fillStyle = bgCol;
  g.fillRect(0, 0, w, h);

  // Thick safety-style border (yellow/black style readability)
  g.fillStyle = accentCol;
  g.fillRect(0, 0, w, 48);
  g.fillRect(0, h - 48, w, 48);
  g.fillRect(0, 0, 48, h);
  g.fillRect(w - 48, 0, 48, h);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 16;
  g.strokeRect(64, 64, w - 128, h - 128);

  // Inner panel for max contrast
  g.fillStyle = "#000000";
  g.fillRect(96, 96, w - 192, h - 192);

  g.textAlign = "center";
  g.textBaseline = "middle";

  const line1 = String(title || "TRACK").toUpperCase();
  const line2 = String(sub || "").toUpperCase();
  const line3 = String(tag || "").toUpperCase();

  // Fit font so the whole line fits with margin
  function fitFont(text, maxPx, minPx, maxWidth) {
    let size = maxPx;
    g.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
    while (size > minPx && g.measureText(text).width > maxWidth) {
      size -= 8;
      g.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
    }
    return size;
  }

  const maxW = w - 220;
  const s1 = fitFont(line1, 220, 72, maxW);
  g.font = `900 ${s1}px Impact, "Arial Black", sans-serif`;
  // Double stroke for "can't miss" edges
  g.lineJoin = "round";
  g.miterLimit = 2;
  g.lineWidth = Math.max(18, s1 * 0.12);
  g.strokeStyle = "#000";
  g.strokeText(line1, w / 2, h * 0.32);
  g.lineWidth = Math.max(8, s1 * 0.05);
  g.strokeStyle = accentCol;
  g.strokeText(line1, w / 2, h * 0.32);
  g.fillStyle = "#FFFFFF";
  g.fillText(line1, w / 2, h * 0.32);

  if (line2) {
    const s2 = fitFont(line2, 140, 56, maxW);
    g.font = `900 ${s2}px Impact, "Arial Black", sans-serif`;
    g.lineWidth = Math.max(14, s2 * 0.1);
    g.strokeStyle = "#000";
    g.strokeText(line2, w / 2, h * 0.55);
    g.fillStyle = accentCol;
    g.fillText(line2, w / 2, h * 0.55);
  }

  if (line3) {
    const s3 = fitFont(line3, 90, 40, maxW);
    g.font = `900 ${s3}px Impact, "Arial Black", sans-serif`;
    g.lineWidth = Math.max(10, s3 * 0.1);
    g.strokeStyle = "#000";
    g.strokeText(line3, w / 2, h * 0.75);
    g.fillStyle = "#FFFFFF";
    g.fillText(line3, w / 2, h * 0.75);
  }

  // Corner chevrons so it reads as a race board even blurred
  g.fillStyle = accentCol;
  g.beginPath();
  g.moveTo(96, 96);
  g.lineTo(220, 96);
  g.lineTo(96, 220);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(w - 96, h - 96);
  g.lineTo(w - 220, h - 96);
  g.lineTo(w - 96, h - 220);
  g.closePath();
  g.fill();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.needsUpdate = true;
  return t;
}

/** Unlit billboard material — never crushed by night lighting */
function signMaterial(tex) {
  return new THREE.MeshBasicMaterial({
    map: tex,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function loadTexture(url, loader) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    loader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      () => resolve(null)
    );
  });
}

// ---------- Track geometry ----------
function buildTrackSurface(dirt) {
  const segs = 128;
  const lanes = 12;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < segs; i++) {
    for (let L = 0; L < lanes; L++) {
      const t0 = (i / segs) * TAU;
      const t1 = ((i + 1) / segs) * TAU;
      const la = L / lanes;
      const lb = (L + 1) / lanes;
      const corners = [
        linePoint(t0, la),
        linePoint(t1, la),
        linePoint(t1, lb),
        linePoint(t0, lb),
      ];
      const base = positions.length / 3;
      for (const c of corners) {
        positions.push(c.x, c.z, c.y); // three.js Y-up: world y = height, z = track y
        normals.push(0, 1, 0);
      }
      uvs.push(i / segs, la, (i + 1) / segs, la, (i + 1) / segs, lb, i / segs, lb);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: dirt.map,
    normalMap: dirt.normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: dirt.rough,
    roughness: 0.88,
    metalness: 0.02,
    color: new THREE.Color(TRACK.clay || "#c9a882"),
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function buildWallRing(inner = false) {
  const segs = 96;
  const group = new THREE.Group();
  const h = inner ? 0.55 : 2.5;
  const baseZ = inner ? 0 : TRACK.bank;

  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * TAU;
    const t1 = ((i + 1) / segs) * TAU;
    const ang0 = Math.PI / 2 - t0;
    const ang1 = Math.PI / 2 - t1;
    const rx = inner ? TRACK.innerRx : TRACK.outerRx;
    const ry = inner ? TRACK.innerRy : TRACK.outerRy;
    const a = new THREE.Vector3(Math.cos(ang0) * rx, baseZ, Math.sin(ang0) * ry);
    const b = new THREE.Vector3(Math.cos(ang1) * rx, baseZ, Math.sin(ang1) * ry);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    const geo = new THREE.BoxGeometry(len, h, inner ? 0.45 : 0.7);
    let mat;
    if (inner) {
      mat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? "#e8b923" : "#1a1a1a",
        roughness: 0.7,
        metalness: 0.1,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? "#c8c8c8" : "#a8a8a8",
        roughness: 0.55,
        metalness: 0.15,
      });
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(mid);
    m.position.y += h / 2;
    m.lookAt(new THREE.Vector3(TRACK.cx, baseZ, TRACK.cy));
    // orient along segment
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    m.rotation.y = Math.atan2(dir.x, dir.z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);

    if (!inner) {
      // red/white top stripe
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(len * 0.98, 0.35, 0.72),
        new THREE.MeshStandardMaterial({
          color: i % 2 === 0 ? "#d62828" : "#f5f5f5",
          roughness: 0.45,
          metalness: 0.05,
          emissive: i % 2 === 0 ? "#400000" : "#222",
          emissiveIntensity: 0.15,
        })
      );
      stripe.position.copy(mid);
      stripe.position.y = baseZ + h - 0.1;
      stripe.rotation.y = Math.atan2(dir.x, dir.z);
      group.add(stripe);
    }
  }
  return group;
}

function buildCatchFence() {
  const group = new THREE.Group();
  const segs = 64;
  const mat = new THREE.MeshStandardMaterial({
    color: "#9aa0a8",
    metalness: 0.85,
    roughness: 0.35,
  });
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * TAU;
    const ang = Math.PI / 2 - t;
    const x = Math.cos(ang) * (TRACK.outerRx + 0.5);
    const z = Math.sin(ang) * (TRACK.outerRy + 0.5);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6), mat);
    post.position.set(x, TRACK.bank + 2.5 + 1.3, z);
    post.castShadow = true;
    group.add(post);
  }
  // cable rings as thin tori-ish line loops via tubes
  for (let ring = 0; ring < 3; ring++) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * TAU;
      const ang = Math.PI / 2 - t;
      const x = Math.cos(ang) * (TRACK.outerRx + 0.5);
      const z = Math.sin(ang) * (TRACK.outerRy + 0.5);
      pts.push(new THREE.Vector3(x, TRACK.bank + 2.7 + ring * 0.7, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 64, 0.025, 4, true),
      new THREE.MeshStandardMaterial({ color: "#bcc2c8", metalness: 0.9, roughness: 0.3 })
    );
    group.add(tube);
  }
  return group;
}

function buildInfield(grassMap) {
  const geo = new THREE.CircleGeometry(TRACK.innerRx * 0.98, 64);
  geo.scale(1, TRACK.innerRy / TRACK.innerRx, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    map: grassMap,
    roughness: 0.95,
    metalness: 0,
    color: "#9bc46a",
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.02;
  m.receiveShadow = true;
  return m;
}

function buildGrassField(grassMap) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({
      map: grassMap,
      roughness: 1,
      metalness: 0,
      color: "#7a9a50",
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.05;
  m.receiveShadow = true;
  return m;
}

function buildLights(scene) {
  const positions = [
    [-110, -70],
    [110, -70],
    [-110, 70],
    [110, 70],
    [0, -85],
    [0, 85],
  ];
  const group = new THREE.Group();
  for (const [x, z] of positions) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.35, 14, 8),
      new THREE.MeshStandardMaterial({ color: "#444", metalness: 0.6, roughness: 0.4 })
    );
    pole.position.set(x, 7, z);
    pole.castShadow = true;
    group.add(pole);

    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 0.4, 1.2),
      new THREE.MeshStandardMaterial({
        color: "#333",
        emissive: "#ffd88a",
        emissiveIntensity: 1.1,
        metalness: 0.45,
        roughness: 0.35,
      })
    );
    lamp.position.set(x, 14.2, z);
    group.add(lamp);

    // Stadium flood — warm, not nuclear
    const spot = new THREE.SpotLight(0xffe8b8, 220, 200, Math.PI / 3.8, 0.5, 1.05);
    spot.position.set(x, 14, z);
    spot.target.position.set(x * 0.12, 0.4, z * 0.12);
    spot.castShadow = false; // key light handles shadows; saves phones
    scene.add(spot);
    scene.add(spot.target);
    group.add(spot);
  }
  return group;
}

function buildBillboards() {
  const group = new THREE.Group();
  const signs =
    TRACK.signs && TRACK.signs.length
      ? TRACK.signs
      : [
          { title: TRACK.shortName || "DIRT", sub: "SPEEDWAY", tag: TRACK.location, bg: "#000", accent: "#FFD200" },
          { title: "PERMANN", sub: "DIESEL", tag: "SOLUTIONS", bg: "#000", accent: "#3d9e3a" },
          { title: "COLORADO", sub: "PAWN", tag: "JEWELRY", bg: "#000", accent: "#FFD200" },
        ];

  // Fewer, closer, huge boards so you actually read them while racing
  const count = Math.max(signs.length, 6);
  for (let i = 0; i < count; i++) {
    const s = signs[i % signs.length];
    const t = (i / count) * TAU + 0.15;
    const ang = Math.PI / 2 - t;
    // Closer to the wall so type is large on screen
    const x = Math.cos(ang) * (TRACK.outerRx + 9);
    const z = Math.sin(ang) * (TRACK.outerRy + 8);
    const tex = makeSponsorTexture(s.title, s.sub, s.tag, s.bg || "#000", s.accent || "#FFD200");

    const postMat = new THREE.MeshStandardMaterial({ color: "#1a1a1a", metalness: 0.4, roughness: 0.5 });
    const halfW = 12;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 10, 8), postMat);
      const px = x + Math.cos(ang + Math.PI / 2) * side * halfW * 0.85;
      const pz = z + Math.sin(ang + Math.PI / 2) * side * halfW * 0.85;
      post.position.set(px, 5, pz);
      group.add(post);
    }

    // Massive unlit face — not affected by night darkness
    const boardW = 24;
    const boardH = 12;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardH), signMaterial(tex));
    board.position.set(x, 8.5, z);
    // Face track center, keep upright
    board.lookAt(0, 8.5, 0);
    group.add(board);

    // Bright frame edge so silhouette pops
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(boardW + 0.6, boardH + 0.6),
      new THREE.MeshBasicMaterial({ color: s.accent || "#FFD200", side: THREE.DoubleSide, toneMapped: false })
    );
    frame.position.copy(board.position);
    frame.quaternion.copy(board.quaternion);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(board.quaternion);
    frame.position.addScaledVector(n, -0.08);
    group.add(frame);

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(boardW + 0.4, boardH + 0.4),
      new THREE.MeshBasicMaterial({ color: "#050505", side: THREE.DoubleSide, toneMapped: false })
    );
    back.position.copy(board.position);
    back.quaternion.copy(board.quaternion);
    back.position.addScaledVector(n, -0.2);
    group.add(back);
  }

  // Giant start/finish marquee — impossible to miss
  const marqueeTex = makeSponsorTexture(
    TRACK.shortName || TRACK.name || "DIRT",
    TRACK.location || "SPEEDWAY",
    "START / FINISH",
    "#000000",
    "#FFD200"
  );
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(36, 14), signMaterial(marqueeTex));
  marquee.position.set(0, 12, TRACK.outerRy + 14);
  marquee.lookAt(0, 12, 0);
  group.add(marquee);

  for (const sx of [-15, 15]) {
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 16, 1.4),
      new THREE.MeshStandardMaterial({ color: "#222", metalness: 0.4, roughness: 0.5 })
    );
    tower.position.set(sx, 8, TRACK.outerRy + 14);
    group.add(tower);
  }

  return group;
}

function buildBleachers() {
  const group = new THREE.Group();
  const places = [
    { x: 0, z: -TRACK.outerRy - 16, rot: 0 },
    { x: 0, z: TRACK.outerRy + 16, rot: Math.PI },
  ];
  for (const p of places) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(40, 5, 8),
      new THREE.MeshStandardMaterial({ color: "#3a3a45", roughness: 0.8, metalness: 0.1 })
    );
    body.position.set(p.x, 2.5, p.z);
    body.rotation.y = p.rot;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
  }
  return group;
}

function buildFinishLine() {
  const group = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const la = i / 10;
    const lb = (i + 1) / 10;
    const a = linePoint(-0.015, la);
    const b = linePoint(0.015, la);
    const c = linePoint(0.015, lb);
    const w = Math.hypot(b.x - a.x, b.y - a.y);
    const d = Math.hypot(
      linePoint(0, lb).x - linePoint(0, la).x,
      linePoint(0, lb).y - linePoint(0, la).y
    );
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.04, Math.max(d, 0.8)),
      new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? "#111" : "#eee",
        roughness: 0.6,
        metalness: 0.05,
      })
    );
    const mid = linePoint(0, (la + lb) * 0.5);
    tile.position.set(mid.x, mid.z + 0.03, mid.y);
    tile.rotation.y = lineHeading(0);
    group.add(tile);
  }
  return group;
}

// ---------- Late model car ----------
function buildLateModel(driver, photoTex) {
  const g = new THREE.Group();
  const bodyCol = new THREE.Color(driver.body || "#1a1a1a");
  const accent = new THREE.Color(driver.accent || "#e85d04");
  const trim = new THREE.Color(driver.trim || "#3d9e3a");

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: bodyCol,
    roughness: 0.35,
    metalness: 0.25,
    clearcoat: 0.65,
    clearcoatRoughness: 0.25,
  });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: accent,
    roughness: 0.4,
    metalness: 0.2,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
  });
  const trimMat = new THREE.MeshPhysicalMaterial({
    color: trim,
    roughness: 0.45,
    metalness: 0.15,
    clearcoat: 0.4,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: "#0a0a0a",
    roughness: 0.1,
    metalness: 0.1,
    transmission: 0.15,
    thickness: 0.2,
    transparent: true,
    opacity: 0.85,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.95, metalness: 0 });

  // Main body
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.85, 1.85), bodyMat);
  chassis.position.y = 0.55;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  g.add(chassis);

  // Nose
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 1.6), bodyMat);
  nose.position.set(2.4, 0.45, 0);
  nose.castShadow = true;
  g.add(nose);

  // Sail panels / roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 1.5), accentMat);
  roof.position.set(-0.2, 1.25, 0);
  roof.castShadow = true;
  g.add(roof);

  // Window opening
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.35), glassMat);
  win.position.set(0.15, 1.2, 0);
  g.add(win);

  // Rear quarter flares
  const rq = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 1.95), bodyMat);
  rq.position.set(-1.4, 0.7, 0);
  rq.castShadow = true;
  g.add(rq);

  // Spoiler
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.55, 2.05), trimMat);
  wing.position.set(-2.15, 1.35, 0);
  wing.castShadow = true;
  g.add(wing);
  const wingTop = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 2.1), trimMat);
  wingTop.position.set(-2.0, 1.65, 0);
  g.add(wingTop);

  // Side skirts
  const skirtL = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 0.12), trimMat);
  skirtL.position.set(0.1, 0.2, 0.95);
  g.add(skirtL);
  const skirtR = skirtL.clone();
  skirtR.position.z = -0.95;
  g.add(skirtR);

  // Photo decals on doors
  if (photoTex) {
    photoTex.wrapS = photoTex.wrapT = THREE.ClampToEdgeWrapping;
    const decalMat = new THREE.MeshStandardMaterial({
      map: photoTex,
      roughness: 0.45,
      metalness: 0.1,
      transparent: true,
    });
    const sideGeo = new THREE.PlaneGeometry(3.2, 1.1);
    const left = new THREE.Mesh(sideGeo, decalMat);
    left.position.set(0.1, 0.75, 0.94);
    g.add(left);
    const right = new THREE.Mesh(sideGeo, decalMat.clone());
    right.position.set(0.1, 0.75, -0.94);
    right.rotation.y = Math.PI;
    g.add(right);
  }

  // Accent stripe
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.12, 1.86),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.2, emissive: accent, emissiveIntensity: 0.08 })
  );
  stripe.position.set(0.1, 0.95, 0);
  g.add(stripe);

  // Wheels — cylinder default axis is +Y; rotate so axle is along car local Z (left-right)
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 20);
  const rimMat = new THREE.MeshStandardMaterial({
    color: driver.number === "37" || driver.number === "777" ? trim : "#444",
    metalness: 0.65,
    roughness: 0.35,
  });
  const wheelPos = [
    [1.4, 0.42, 0.98],
    [1.4, 0.42, -0.98],
    [-1.35, 0.42, 0.98],
    [-1.35, 0.42, -0.98],
  ];
  for (const [x, y, z] of wheelPos) {
    const tire = new THREE.Mesh(wheelGeo, rubber);
    // Axle along Z (car width) so the disk faces outward — NOT sideways along the body
    tire.rotation.x = Math.PI / 2;
    tire.position.set(x, y, z);
    tire.castShadow = true;
    g.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.4, 16), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, y, z);
    g.add(rim);
  }

  // Number plate sprite-like
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const cg = canvas.getContext("2d");
  cg.fillStyle = "rgba(0,0,0,0)";
  cg.clearRect(0, 0, 256, 128);
  cg.font = "bold 90px Bebas Neue, Impact, sans-serif";
  cg.textAlign = "center";
  cg.textBaseline = "middle";
  cg.strokeStyle = "#000";
  cg.lineWidth = 10;
  cg.strokeText(String(driver.number || "?"), 128, 64);
  cg.fillStyle = driver.stripe || "#fff";
  cg.fillText(String(driver.number || "?"), 128, 64);
  const numTex = new THREE.CanvasTexture(canvas);
  numTex.colorSpace = THREE.SRGBColorSpace;
  const num = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.7),
    new THREE.MeshStandardMaterial({ map: numTex, transparent: true, depthWrite: false })
  );
  num.position.set(0.3, 0.9, 0.96);
  g.add(num);
  const num2 = num.clone();
  num2.position.z = -0.96;
  num2.rotation.y = Math.PI;
  g.add(num2);

  g.userData.driver = driver;
  return g;
}

// ---------- Race session ----------
export class RaceSession {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.opts = options;
    this.audio = new RaceAudio();
    this.keys = Object.create(null);
    this.state = "ready";
    this.cars = [];
    this.player = null;
    this.carMeshes = [];
    this.raceTime = 0;
    this.bestLap = null;
    this.countdown = 3;
    this.countdownTimer = 0;
    this.lookBack = false;
    this._running = false;
    this._raf = 0;
    this._last = 0;
    this.hud = options.hud || {};
    this.trackConfig = options.track || null;
    this.onFinish = options.onFinish || (() => {});
    this.onQuit = options.onQuit || (() => {});
    this._boundKeyDown = (e) => this._onKey(e, true);
    this._boundKeyUp = (e) => this._onKey(e, false);
    this._onResize = () => this._resize();
    this._onBlur = () => {
      for (const k of Object.keys(this.keys)) this.keys[k] = false;
    };
    this.dust = null;
    this.composer = null;
    this._disposed = false;
    this._cheerTimer = 8 + Math.random() * 6;
    this._lastPassCheerAt = 0;
    // Phone tilt / accelerometer steering
    this.tilt = {
      enabled: false,
      steer: 0, // -1 .. 1
      pitch: 0, // -1 .. 1 (forward lean)
      rawSteer: 0,
      rawPitch: 0,
      calSteer: 0,
      calPitch: 0,
      sensitivity: 1.35,
      deadzone: 0.08,
    };
    this._onOrient = (e) => this._handleOrientation(e);
    this._onMotion = (e) => this._handleMotion(e);
  }

  async start() {
    try {
      if (this.trackConfig) applyTrackConfig(this.trackConfig);
      this._buildField();
      await this._initThree();
      if (this._disposed) return;
      this.state = "ready";
      this.raceTime = 0;
      this.bestLap = null;
      this._running = true;
      this._last = performance.now();
      window.addEventListener("keydown", this._boundKeyDown);
      window.addEventListener("keyup", this._boundKeyUp);
      window.addEventListener("resize", this._onResize);
      window.addEventListener("blur", this._onBlur);
      this._bindTouchControls();
      this._raf = requestAnimationFrame((t) => this._frame(t));
    } catch (err) {
      this.destroy();
      throw err;
    }
  }

  async greenFlag() {
    await this.audio.resume();
    // Warm up voices list (Chrome loads async)
    try {
      speechSynthesis?.getVoices?.();
    } catch (_) {}
    this.state = "countdown";
    this.countdown = 3;
    this.countdownTimer = 1;
    this.audio.beep("count");
    this._cheerTimer = 5 + Math.random() * 4;
    if (this.opts.onCountdown) this.opts.onCountdown(3);
  }

  destroy() {
    if (this._disposed) return;
    this._disposed = true;
    this._running = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    window.removeEventListener("keydown", this._boundKeyDown);
    window.removeEventListener("keyup", this._boundKeyUp);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("blur", this._onBlur);
    if (this._touchRoot) this._touchRoot.classList.remove("active");
    this.disableTilt();
    try {
      this.audio.stopAll();
    } catch (_) {}

    // Dispose GPU resources WITHOUT forceContextLoss (that breaks the next race)
    try {
      if (this.composer) {
        this.composer.passes?.forEach((p) => p.dispose?.());
        this.composer = null;
      }
      if (this.scene) {
        this.scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (m.map && m.map.isTexture) m.map.dispose();
              if (m.normalMap && m.normalMap.isTexture) m.normalMap.dispose();
              if (m.roughnessMap && m.roughnessMap.isTexture) m.roughnessMap.dispose();
              if (m.emissiveMap && m.emissiveMap.isTexture) m.emissiveMap.dispose();
              m.dispose?.();
            }
          }
        });
        this.scene.clear();
        this.scene = null;
      }
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer = null;
      }
    } catch (err) {
      console.warn("WebGL cleanup:", err);
    }

    // Fresh canvas node so the next WebGLRenderer always gets a clean context
    try {
      const old = this.canvas;
      if (old && old.parentElement) {
        const fresh = document.createElement("canvas");
        fresh.id = old.id || "game";
        fresh.className = old.className;
        old.replaceWith(fresh);
        this.canvas = fresh;
      }
    } catch (_) {}

    this.carMeshes = [];
    this.camera = null;
    this.hood = null;
    this.dust = null;
  }

  _onKey(e, down) {
    this.keys[e.code] = down;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (down && e.code === "Escape" && this.state !== "finished") {
      this.destroy();
      this.onQuit();
    }
    if (e.code === "KeyC") this.lookBack = down;
  }

  /** Virtual buttons / touch pads write into this.keys */
  setVirtual(code, down) {
    this.keys[code] = !!down;
    if (code === "KeyC") this.lookBack = !!down;
  }

  _pressed(c) {
    return !!this.keys[c];
  }

  _bindTouchControls() {
    const root = document.getElementById("touch-controls");
    if (!root) return;
    root.classList.add("active");
    this._touchRoot = root;

    const bind = (el, code) => {
      if (!el) return;
      const down = (e) => {
        e.preventDefault();
        el.classList.add("pressed");
        this.setVirtual(code, true);
      };
      const up = (e) => {
        e.preventDefault();
        el.classList.remove("pressed");
        this.setVirtual(code, false);
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointerleave", up);
      el.addEventListener("pointercancel", up);
    };

    bind(root.querySelector("[data-key='throttle']"), "KeyW");
    bind(root.querySelector("[data-key='left']"), "KeyA");
    bind(root.querySelector("[data-key='right']"), "KeyD");
    bind(root.querySelector("[data-key='handbrake']"), "Space");
    bind(root.querySelector("[data-key='look']"), "KeyC");

    const quit = root.querySelector("[data-key='quit']");
    if (quit) {
      quit.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (this.state !== "finished") {
          this.destroy();
          this.onQuit();
        }
      });
    }

    // Hide / show extra controls (steer, tilt, look, quit)
    const hideBtn = root.querySelector("#btn-touch-hide") || document.getElementById("btn-touch-hide");
    if (hideBtn) {
      // Start collapsed for a cleaner race view
      root.classList.remove("extras-open");
      hideBtn.setAttribute("aria-expanded", "false");
      hideBtn.textContent = "•••";
      hideBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const open = root.classList.toggle("extras-open");
        hideBtn.setAttribute("aria-expanded", open ? "true" : "false");
        hideBtn.textContent = open ? "✕" : "•••";
      });
    }

    // Tilt steering toggle + calibrate (needs user gesture on iOS)
    const tiltBtn = root.querySelector("[data-key='tilt']");
    if (tiltBtn) {
      tiltBtn.addEventListener("pointerdown", async (e) => {
        e.preventDefault();
        if (this.tilt.enabled) {
          this.disableTilt();
          tiltBtn.classList.remove("pressed", "tilt-on");
          tiltBtn.textContent = "TILT";
          this._setTiltStatus("Tilt off — use ◀ ▶");
        } else {
          const ok = await this.enableTilt();
          if (ok) {
            tiltBtn.classList.add("pressed", "tilt-on");
            tiltBtn.textContent = "TILT ON";
            this._setTiltStatus("Tilt ON — lean phone to steer");
          } else {
            this._setTiltStatus("Tilt blocked — allow motion in browser settings");
          }
        }
      });
    }
    const calBtn = root.querySelector("[data-key='cal']");
    if (calBtn) {
      calBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.calibrateTilt();
        calBtn.classList.add("pressed");
        setTimeout(() => calBtn.classList.remove("pressed"), 200);
        this._setTiltStatus("Calibrated — hold phone level, then race");
      });
    }

    // Auto-offer tilt on phones (Android has no permission prompt; iOS needs a tap)
    if (window.matchMedia("(pointer: coarse)").matches) {
      const needsPerm =
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function";
      if (needsPerm) {
        this._setTiltStatus("iPhone: tap TILT and Allow motion access");
      } else {
        this._setTiltStatus("Android: tap TILT (or wait) — lean to steer");
        // Auto-enable on Android/Chrome — no user permission API required
        setTimeout(() => {
          if (this._disposed || this.tilt.enabled) return;
          this.enableTilt().then((ok) => {
            if (!ok) return;
            const tiltBtn = root.querySelector("[data-key='tilt']");
            if (tiltBtn) {
              tiltBtn.classList.add("pressed", "tilt-on");
              tiltBtn.textContent = "TILT ON";
            }
            this._setTiltStatus("Tilt ON — lean L/R to steer · tap CAL if needed");
          });
        }, 400);
      }
    }
  }

  _setTiltStatus(msg) {
    const el = document.getElementById("tilt-status");
    if (el) el.textContent = msg || "";
  }

  async enableTilt() {
    try {
      // iOS 13+ requires permission from a user gesture
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        const p = await DeviceOrientationEvent.requestPermission();
        if (p !== "granted") return false;
      }
      if (typeof DeviceMotionEvent !== "undefined" &&
          typeof DeviceMotionEvent.requestPermission === "function") {
        try {
          await DeviceMotionEvent.requestPermission();
        } catch (_) {}
      }

      window.addEventListener("deviceorientation", this._onOrient, true);
      window.addEventListener("devicemotion", this._onMotion, true);
      this.tilt.enabled = true;
      // Capture neutral after a short settle
      setTimeout(() => this.calibrateTilt(), 250);
      return true;
    } catch (err) {
      console.warn("Tilt enable failed:", err);
      return false;
    }
  }

  disableTilt() {
    this.tilt.enabled = false;
    this.tilt.steer = 0;
    this.tilt.pitch = 0;
    window.removeEventListener("deviceorientation", this._onOrient, true);
    window.removeEventListener("devicemotion", this._onMotion, true);
  }

  calibrateTilt() {
    this.tilt.calSteer = this.tilt.rawSteer;
    this.tilt.calPitch = this.tilt.rawPitch;
    this.tilt.steer = 0;
    this.tilt.pitch = 0;
  }

  _applyTiltAxes(steerDeg, pitchDeg) {
    this.tilt.rawSteer = steerDeg;
    this.tilt.rawPitch = pitchDeg;
    if (!this.tilt.enabled) return;

    let s = (steerDeg - this.tilt.calSteer) / 28; // ~28° = full lock
    let p = (pitchDeg - this.tilt.calPitch) / 35;
    s *= this.tilt.sensitivity;
    p *= this.tilt.sensitivity;

    const dz = this.tilt.deadzone;
    if (Math.abs(s) < dz) s = 0;
    else s = Math.sign(s) * ((Math.abs(s) - dz) / (1 - dz));
    if (Math.abs(p) < dz) p = 0;
    else p = Math.sign(p) * ((Math.abs(p) - dz) / (1 - dz));

    // Smooth so the car doesn't jitter
    this.tilt.steer = lerp(this.tilt.steer, clamp(s, -1, 1), 0.35);
    this.tilt.pitch = lerp(this.tilt.pitch, clamp(p, -1, 1), 0.25);
  }

  /**
   * DeviceOrientation: gamma ≈ left/right (portrait), beta ≈ front/back.
   * In landscape we swap so “wheel lean” still steers left/right.
   */
  _handleOrientation(e) {
    if (e.gamma == null && e.beta == null) return;
    this._lastOrientAt = performance.now();
    const gamma = e.gamma ?? 0; // -90..90
    const beta = e.beta ?? 0; // -180..180

    const type = (screen.orientation && screen.orientation.type) || "";
    let steerAxis = gamma;
    let pitchAxis = beta - 45; // neutral-ish when looking slightly down at phone

    if (type.includes("landscape")) {
      // Phone on its side: beta becomes the main left/right lean
      if (type.includes("secondary")) {
        steerAxis = -beta;
        pitchAxis = gamma;
      } else {
        steerAxis = beta;
        pitchAxis = -gamma;
      }
    }

    this._applyTiltAxes(steerAxis, pitchAxis);
  }

  /**
   * Accelerometer (DeviceMotion) — primary path on many Android phones
   * when deviceorientation is throttled or missing.
   */
  _handleMotion(e) {
    if (!this.tilt.enabled) return;
    const a = e.accelerationIncludingGravity;
    if (!a || (a.x == null && a.y == null)) return;

    // Prefer fresh orientation if it's actually moving; else use accel
    const orientStrong = Math.abs(this.tilt.rawSteer - this.tilt.calSteer) > 2.5;
    if (orientStrong && this._lastOrientAt && performance.now() - this._lastOrientAt < 120) {
      return;
    }

    const type = (screen.orientation && screen.orientation.type) || "";
    let ax = a.x ?? 0;
    let ay = a.y ?? 0;
    // Android portrait: x = left/right. Landscape: y becomes left/right.
    if (type.includes("landscape")) {
      ax = type.includes("secondary") ? -(a.y ?? 0) : (a.y ?? 0);
      ay = -(a.x ?? 0);
    }
    // g-forces → pseudo-degrees for shared apply path
    this._applyTiltAxes(ax * 7, ay * 5);
  }

  /** Player input: keys/buttons + optional analog tilt */
  _readPlayerControls(car) {
    car.throttle = this._pressed("KeyW") || this._pressed("ArrowUp") ? 1 : 0;
    car.brake = this._pressed("KeyS") || this._pressed("ArrowDown") ? 1 : 0;
    car.handbrake = this._pressed("Space") ? 1 : 0;

    let steer = 0;
    if (this._pressed("KeyA") || this._pressed("ArrowLeft")) steer -= 1;
    if (this._pressed("KeyD") || this._pressed("ArrowRight")) steer += 1;

    if (this.tilt.enabled) {
      // Buttons override when held; otherwise full analog tilt
      if (steer === 0) {
        steer = this.tilt.steer;
      } else {
        // slight blend so you can fine-tune with tilt while holding a pad
        steer = clamp(steer + this.tilt.steer * 0.25, -1, 1);
      }
      // Optional: lean phone forward for a bit of gas if not touching pedals
      if (!car.throttle && !car.brake && this.tilt.pitch > 0.35) {
        car.throttle = clamp((this.tilt.pitch - 0.35) / 0.65, 0, 0.85);
      }
      if (!car.brake && !this._pressed("KeyW") && this.tilt.pitch < -0.45) {
        car.brake = clamp((-this.tilt.pitch - 0.45) / 0.55, 0, 0.7);
      }
    }

    car.steer = clamp(steer, -1, 1);

    // Tilt indicator on HUD
    const ind = document.getElementById("tilt-meter");
    if (ind && this.tilt.enabled) {
      const pct = 50 + this.tilt.steer * 50;
      ind.style.setProperty("--tilt", `${clamp(pct, 0, 100)}%`);
      ind.classList.add("on");
    } else if (ind) {
      ind.classList.remove("on");
    }
  }

  _buildField() {
    const laps = this.opts.laps || 8;
    const stats = this.opts.playerStats || { power: 1, grip: 1, handling: 1, brakes: 1, aero: 1 };
    const rivals = this.opts.rivals || [];
    this.cars = [];
    const field = [
      { driver: { ...PLAYER, isPlayer: true }, stats },
      ...rivals.map((r) => ({
        driver: { ...r, isPlayer: false },
        stats: {
          power: 0.92 + r.skill * 0.12,
          grip: 0.9 + r.skill * 0.1,
          handling: 0.9 + r.skill * 0.12,
          brakes: 0.9 + r.skill * 0.1,
          aero: 0.95,
        },
      })),
    ];
    field.forEach((entry, i) => {
      const lane = 0.32 + (i % 2) * 0.18 + (i > 3 ? 0.08 : 0);
      const prog = 0.1 + i * 0.055;
      const p = linePoint(prog, lane);
      this.cars.push({
        driver: entry.driver,
        isPlayer: !!entry.driver.isPlayer,
        x: p.x,
        y: p.y,
        angle: lineHeading(prog),
        speed: 0,
        slip: 0,
        throttle: 0,
        brake: 0,
        steer: 0,
        handbrake: 0,
        lap: 0,
        progress: prog,
        lastProgress: prog,
        finished: false,
        finishTime: 0,
        lapStart: 0,
        stats: entry.stats,
        maxSpeed: 38 * entry.stats.power,
        accel: 30 * entry.stats.power,
        grip: 1.12 * entry.stats.grip,
        turn: 2.5 * entry.stats.handling,
        brakePower: 44 * entry.stats.brakes,
        skill: entry.driver.skill || 1,
        aggression: entry.driver.aggression || 0.5,
        aiLane: lane,
        width: 1.9,
        length: 4.4,
      });
    });
    this.player = this.cars.find((c) => c.isPlayer);
    this.totalLaps = laps;
  }

  async _initThree() {
    const canvas = this.canvas;
    const isPhone = window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
    this._isPhone = isPhone;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isPhone,
      powerPreference: isPhone ? "low-power" : "high-performance",
      alpha: false,
    });
    // Cap DPR on phones so WebGL stays smooth
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.5 : 2));
    this.renderer.shadowMap.enabled = !isPhone;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Balanced night race — readable clay, not daylight blast
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(TRACK.sky || "#0c101c");
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(TRACK.sky || "#0c101c").getHex(),
      0.0042
    );

    this.camera = new THREE.PerspectiveCamera(isPhone ? 72 : 68, 1, 0.1, 500);
    this.camera.position.set(0, 1.2, 0);

    // Night stadium balance: soft fill + one key + flood banks
    this.scene.add(new THREE.AmbientLight(0x8a94b0, 0.48));
    const hemi = new THREE.HemisphereLight(0xb8c4e0, 0x3a2818, 0.55);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe8c8, 0.55);
    key.position.set(40, 70, 25);
    if (!isPhone) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 250;
      key.shadow.camera.left = -120;
      key.shadow.camera.right = 120;
      key.shadow.camera.top = 120;
      key.shadow.camera.bottom = -120;
    }
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aadd, 0.22);
    rim.position.set(-50, 35, -30);
    this.scene.add(rim);
    // Gentle center fill — keeps groove visible without washing out
    const centerFill = new THREE.PointLight(0xffd9a0, 45, 140, 1.4);
    centerFill.position.set(0, 16, 0);
    this.scene.add(centerFill);

    const dirt = makeDirtMaps();
    const grass = makeGrassMap();

    this.scene.add(buildGrassField(grass));
    this.scene.add(buildInfield(grass));
    this.scene.add(buildTrackSurface(dirt));
    this.scene.add(buildWallRing(false));
    this.scene.add(buildWallRing(true));
    this.scene.add(buildCatchFence());
    this.scene.add(buildLights(this.scene));
    this.scene.add(buildBillboards());
    this.scene.add(buildBleachers());
    this.scene.add(buildFinishLine());

    // Dust particle system
    this._initDust();

    // Load car photos & build meshes
    const loader = new THREE.TextureLoader();
    this.carMeshes = [];
    for (const car of this.cars) {
      const src = car.driver.portrait || car.driver.action;
      const tex = await loadTexture(src, loader);
      const mesh = buildLateModel(car.driver, tex);
      this.scene.add(mesh);
      this.carMeshes.push(mesh);
      this._syncCarMesh(car, mesh);
    }

    // Cockpit hood piece in front of camera (player only feel)
    this.hood = new THREE.Group();
    const hoodMat = new THREE.MeshPhysicalMaterial({
      color: "#1a1a1a",
      roughness: 0.35,
      metalness: 0.3,
      clearcoat: 0.6,
    });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.1), hoodMat);
    hood.position.set(0, -0.35, -1.1);
    hood.rotation.x = 0.15;
    this.hood.add(hood);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.02, 0.08),
      new THREE.MeshStandardMaterial({ color: "#e85d04", emissive: "#e85d04", emissiveIntensity: 0.2 })
    );
    stripe.position.set(0, -0.3, -0.7);
    this.hood.add(stripe);
    this.camera.add(this.hood);
    this.scene.add(this.camera);

    // Post-processing bloom for flood lights / night glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Soft lamp bloom only (high threshold = no “drive into the sun”)
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), isPhone ? 0.22 : 0.28, 0.55, 0.88);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this._resize();
  }

  _initDust() {
    const count = 600;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = -10;
      pos[i * 3 + 2] = 0;
      vel.push({ life: 0, vx: 0, vy: 0, vz: 0 });
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe8c090,
      size: 0.6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.userData.vel = vel;
    this.scene.add(this.dust);
  }

  _spawnDust(car, n = 4) {
    if (!this.dust) return;
    const pos = this.dust.geometry.attributes.position.array;
    const vel = this.dust.userData.vel;
    let spawned = 0;
    for (let i = 0; i < vel.length && spawned < n; i++) {
      if (vel[i].life > 0) continue;
      const back = car.angle + Math.PI + (Math.random() - 0.5) * 0.6;
      pos[i * 3] = car.x + Math.cos(back) * 1.5;
      pos[i * 3 + 1] = 0.3 + Math.random() * 0.4;
      pos[i * 3 + 2] = car.y + Math.sin(back) * 1.5;
      vel[i].life = 0.4 + Math.random() * 0.5;
      vel[i].vx = Math.cos(back) * (2 + Math.random() * 3);
      vel[i].vy = 1 + Math.random() * 2;
      vel[i].vz = Math.sin(back) * (2 + Math.random() * 3);
      spawned++;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  _updateDust(dt) {
    if (!this.dust) return;
    const pos = this.dust.geometry.attributes.position.array;
    const vel = this.dust.userData.vel;
    for (let i = 0; i < vel.length; i++) {
      if (vel[i].life <= 0) continue;
      vel[i].life -= dt;
      pos[i * 3] += vel[i].vx * dt;
      pos[i * 3 + 1] += vel[i].vy * dt;
      pos[i * 3 + 2] += vel[i].vz * dt;
      vel[i].vy -= 4 * dt;
      if (vel[i].life <= 0) pos[i * 3 + 1] = -10;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  _resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap?.clientWidth || window.innerWidth;
    const h = wrap?.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  _syncCarMesh(car, mesh) {
    const of = radial(car.x, car.y, TRACK.outerRx, TRACK.outerRy);
    const tLane = clamp((of - 0.55) / 0.45, 0, 1);
    mesh.position.set(car.x, laneZ(tLane), car.y);
    mesh.rotation.y = -car.angle;
    mesh.rotation.z = -car.slip * 0.12;
    mesh.rotation.x = tLane * 0.06;
    mesh.visible = car.isPlayer ? this.lookBack : true;
  }

  _updateCamera(dt) {
    const p = this.player;
    if (!p) return;
    const look = this.lookBack ? Math.PI : 0;
    const yaw = p.angle + look + p.slip * 0.08;
    // Camera behind windshield looking forward
    const eyeH = 1.15;
    const back = this.lookBack ? 0.3 : -0.15;
    const cx = p.x + Math.cos(p.angle) * back;
    const cy = p.y + Math.sin(p.angle) * back;
    const of = radial(p.x, p.y, TRACK.outerRx, TRACK.outerRy);
    const tLane = clamp((of - 0.55) / 0.45, 0, 1);
    const ground = laneZ(tLane);

    this.camera.position.set(cx, ground + eyeH, cy);
    const lookDist = 12;
    const lx = p.x + Math.cos(yaw) * lookDist;
    const lz = p.y + Math.sin(yaw) * lookDist;
    this.camera.lookAt(lx, ground + eyeH * 0.85, lz);

    // subtle speed FOV
    const targetFov = 68 + clamp(Math.abs(p.speed) / p.maxSpeed, 0, 1) * 10;
    this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.pow(0.001, dt));
    this.camera.updateProjectionMatrix();
  }

  // ---- physics (same arcade oval model) ----
  _updateCar(car, dt) {
    if (car.finished) {
      car.speed = lerp(car.speed, 0, 1.5 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      this._resolveWalls(car, dt);
      return;
    }

    if (car.isPlayer && this.state === "racing") {
      this._readPlayerControls(car);
    } else if (!car.isPlayer && this.state === "racing") {
      this._ai(car);
    } else {
      car.throttle = car.brake = car.steer = car.handbrake = 0;
    }

    const dirt = onTrack(car.x, car.y);
    const grip = car.grip * (dirt ? 1 : 0.55) * (car.handbrake ? 0.5 : 1);
    const rolling = Math.abs(car.speed) > 0.35;
    const steerDir = car.speed >= 0 ? 1 : -1;
    const steerEff =
      car.turn * (0.28 + clamp(Math.abs(car.speed) / 20, 0, 1)) * (1 - clamp(Math.abs(car.slip) / 2.5, 0, 0.4));
    if (rolling) car.angle += car.steer * steerEff * steerDir * dt;

    if (car.throttle) {
      const pull = car.accel * (0.85 + (1 - clamp(Math.abs(car.speed) / car.maxSpeed, 0, 1)) * 0.35);
      car.speed += pull * car.throttle * dt;
    }
    if (car.brake) {
      if (car.speed > 1.5) car.speed -= car.brakePower * car.brake * dt;
      else car.speed -= 14 * car.brake * dt;
    }
    const drag = car.throttle ? 0.18 : 0.38;
    car.speed -= car.speed * (drag + (1 - grip) * 0.2) * dt;
    if (!car.throttle && !car.brake) car.speed -= car.speed * 0.22 * dt;
    car.speed = clamp(car.speed, -8, car.maxSpeed * (dirt ? 1 : 0.65));
    if (car.throttle && car.speed >= 0 && car.speed < 2.5) car.speed = Math.max(car.speed, 2.5 * car.throttle);

    const slipWant =
      car.steer * clamp((Math.abs(car.speed) - 6) / 20, 0, 1) * (car.handbrake ? 1.45 : 0.8);
    car.slip = lerp(car.slip, slipWant, (car.handbrake ? 3.2 : 1.8) * dt);
    car.slip *= 1 - grip * 2.0 * dt;
    if (Math.abs(car.steer) < 0.05 && !car.handbrake) car.slip *= 1 - 7 * dt;

    const forward = car.speed * dt;
    const lateral = car.speed * car.slip * 0.25 * dt;
    car.x += Math.cos(car.angle) * forward + Math.cos(car.angle + Math.PI / 2) * lateral;
    car.y += Math.sin(car.angle) * forward + Math.sin(car.angle + Math.PI / 2) * lateral;

    this._resolveWalls(car, dt);

    if (dirt && Math.abs(car.speed) > 12 && (Math.abs(car.slip) > 0.2 || car.handbrake)) {
      if (Math.random() < 0.5) this._spawnDust(car, car.isPlayer ? 5 : 2);
    }
    this._updateProgress(car);
  }

  _resolveWalls(car, dt) {
    let impact = 0;
    const of = radial(car.x, car.y, TRACK.outerRx, TRACK.outerRy);
    if (of > TRACK.collideOuter) {
      const ang = Math.atan2(car.y - TRACK.cy, car.x - TRACK.cx);
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      const target = TRACK.collideOuter * 0.995;
      car.x = TRACK.cx + Math.cos(ang) * TRACK.outerRx * target;
      car.y = TRACK.cy + Math.sin(ang) * TRACK.outerRy * target;
      const vx = Math.cos(car.angle) * car.speed;
      const vy = Math.sin(car.angle) * car.speed;
      const vn = vx * nx + vy * ny;
      if (vn > 0) {
        const rx = vx - vn * nx * 1.05;
        const ry = vy - vn * ny * 1.05;
        car.speed = Math.hypot(rx, ry) * Math.sign(car.speed || 1);
        if (car.speed > 3) car.angle = lerpAngle(car.angle, Math.atan2(ry, rx), 0.35);
        impact = clamp(vn / 25, 0, 1);
      } else car.speed *= 1 - 0.15 * dt;
    }
    const inf = radial(car.x, car.y, TRACK.innerRx, TRACK.innerRy);
    if (inf < TRACK.collideInner) {
      const ang = Math.atan2(car.y - TRACK.cy, car.x - TRACK.cx);
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      car.x = TRACK.cx + Math.cos(ang) * TRACK.innerRx * TRACK.collideInner;
      car.y = TRACK.cy + Math.sin(ang) * TRACK.innerRy * TRACK.collideInner;
      const vx = Math.cos(car.angle) * car.speed;
      const vy = Math.sin(car.angle) * car.speed;
      const vn = vx * -nx + vy * -ny;
      if (vn > 0) {
        const rx = vx - vn * -nx * 1.05;
        const ry = vy - vn * -ny * 1.05;
        car.speed = Math.hypot(rx, ry) * Math.sign(car.speed || 1);
        if (car.speed > 3) car.angle = lerpAngle(car.angle, Math.atan2(ry, rx), 0.3);
        impact = Math.max(impact, clamp(vn / 28, 0, 1));
      } else car.speed *= 1 - 0.12 * dt;
    }
    if (impact > 0.2 && car.isPlayer) this.audio.impact(impact);
  }

  _updateProgress(car) {
    const p = progressAt(car.x, car.y);
    const prev = car.lastProgress;
    if (prev > TAU * 0.75 && p < TAU * 0.2 && car.speed > 3) {
      car.lap += 1;
      if (car.isPlayer && car.lap > 0) {
        const lapT = this.raceTime - car.lapStart;
        car.lapStart = this.raceTime;
        if (car.lap <= this.totalLaps) {
          if (this.bestLap == null || lapT < this.bestLap) this.bestLap = lapT;
          this._flash(`LAP ${car.lap}`);
        }
      } else car.lapStart = this.raceTime;
      if (car.lap >= this.totalLaps) {
        car.finished = true;
        car.finishTime = this.raceTime;
        if (car.isPlayer) this._finishRace();
      }
    }
    car.lastProgress = p;
    car.progress = p;
  }

  _ai(car) {
    const look = 0.4 + clamp(car.speed / 40, 0, 0.35);
    const targetT = (car.progress + look) % TAU;
    const lane = clamp(car.aiLane + (car.speed / 80) * 0.1, 0.28, 0.72);
    const target = linePoint(targetT, lane);
    const desired = Math.atan2(target.y - car.y, target.x - car.x);
    const err = normAngle(desired - car.angle);
    car.steer = clamp(err * 2.4 * car.skill, -1, 1);
    const corner = Math.abs(err);
    const targetSpeed = car.maxSpeed * (1 - clamp(corner * 1.15, 0, 0.55));
    if (car.speed > targetSpeed + 2) {
      car.throttle = 0;
      car.brake = 0.55;
      car.handbrake = corner > 0.5 ? 0.5 : 0;
    } else {
      car.throttle = 1;
      car.brake = 0;
      car.handbrake = 0;
    }
    for (const other of this.cars) {
      if (other === car) continue;
      const dx = car.x - other.x;
      const dy = car.y - other.y;
      const d = Math.hypot(dx, dy);
      if (d < 8 && d > 0.01) {
        const away = Math.atan2(dy, dx);
        car.steer = clamp(car.steer + normAngle(away - car.angle) * 0.5 * car.aggression, -1, 1);
        if (d < 4.5 && other.progress > car.progress) car.brake = Math.max(car.brake, 0.6);
      }
    }
  }

  _carCollisions() {
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = 3.6;
        if (d < minD && d > 0.01) {
          const nx = dx / d;
          const ny = dy / d;
          const ov = (minD - d) * 0.5;
          a.x -= nx * ov;
          a.y -= ny * ov;
          b.x += nx * ov;
          b.y += ny * ov;
          const rel = (a.speed - b.speed) * 0.25;
          a.speed -= rel;
          b.speed += rel;
          a.speed *= 0.94;
          b.speed *= 0.94;
          if (Math.abs(rel) > 1.5 && (a.isPlayer || b.isPlayer)) {
            this.audio.impact(clamp(Math.abs(rel) / 8, 0.2, 1));
          }
        }
      }
    }
  }

  _standings() {
    return [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      if (b.lap !== a.lap) return b.lap - a.lap;
      return b.progress - a.progress;
    });
  }

  _playerPlace() {
    return this._standings().findIndex((c) => c.isPlayer) + 1;
  }

  _finishRace() {
    if (this.state === "finished") return;
    this.state = "finished";
    this.audio.cheer();
    if (this._playerPlace() === 1) this.audio.chant("CJ");
    else if (Math.random() < 0.5) this.audio.randomChant();
    const standings = this._standings();
    const place = this._playerPlace();
    this._flash(place === 1 ? "WINNER!" : `${place}${this._ord(place).toUpperCase()} PLACE`);
    setTimeout(() => {
      this.destroy();
      this.onFinish({
        place,
        placeIndex: place - 1,
        standings: standings.map((c, i) => ({
          place: i + 1,
          name: c.driver.name,
          number: c.driver.number,
          isPlayer: c.isPlayer,
          finished: c.finished,
          time: c.finished ? c.finishTime : this.raceTime,
        })),
        raceTime: this.raceTime,
        bestLap: this.bestLap,
      });
    }, 1800);
  }

  _ord(n) {
    return n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  }

  _flash(text) {
    if (this.opts.onFlash) this.opts.onFlash(text);
  }

  _updateHud() {
    const h = this.hud;
    if (!h || !this.player) return;
    if (h.pos) h.pos.textContent = `${this._playerPlace()}/${this.cars.length}`;
    if (h.lap) {
      const L = clamp(this.player.lap + 1, 1, this.totalLaps);
      h.lap.textContent = `${Math.min(L, this.totalLaps)}/${this.totalLaps}`;
    }
    if (h.speed) h.speed.textContent = String(Math.max(0, Math.round(Math.abs(this.player.speed) * 4.2)));
    if (h.best) h.best.textContent = formatTime(this.bestLap);
    if (h.tach) {
      const rpm = clamp(Math.abs(this.player.speed) / this.player.maxSpeed, 0, 1);
      h.tach.style.width = `${Math.round((0.15 + rpm * 0.85 + this.player.throttle * 0.1) * 100)}%`;
    }
  }

  _updateAudio() {
    if (!this.player) return;
    const sp = clamp(Math.abs(this.player.speed) / this.player.maxSpeed, 0, 1);
    const slip = clamp(Math.abs(this.player.slip) / 1.2, 0, 1);
    this.audio.update(sp, this.player.throttle, slip, onTrack(this.player.x, this.player.y));
  }

  /** Occasional grandstand chants: Go CJ / Go Dylan */
  _updateCrowdChants(dt) {
    if (this.state !== "racing" || !this.audio.enabled) return;

    this._cheerTimer -= dt;
    if (this._cheerTimer <= 0) {
      const who = this.audio.randomChant();
      this._flash(who === "Dylan" ? "GO DYLAN!" : "GO CJ!");
      this._cheerTimer = 9 + Math.random() * 12; // every ~9–21s
    }

    // Extra cheer when CJ (player) is in a close battle
    if (this.player && this.raceTime - this._lastPassCheerAt > 14) {
      const place = this._playerPlace();
      const near = this.cars.some((c) => {
        if (c.isPlayer) return false;
        const d = Math.hypot(c.x - this.player.x, c.y - this.player.y);
        return d < 10 && Math.abs(c.progress - this.player.progress) < 0.12;
      });
      if (near && Math.random() < 0.015) {
        // Prefer player name when battling; sometimes Dylan if #777 is close
        const dylanNear = this.cars.some(
          (c) => c.driver?.number === "777" && Math.hypot(c.x - this.player.x, c.y - this.player.y) < 12
        );
        const who = dylanNear && Math.random() < 0.5 ? "Dylan" : "CJ";
        this.audio.chant(who);
        this._flash(who === "Dylan" ? "GO DYLAN!" : "GO CJ!");
        this._lastPassCheerAt = this.raceTime;
        this._cheerTimer = 8 + Math.random() * 6;
      } else if (place === 1 && Math.random() < 0.004) {
        this.audio.chant("CJ");
        this._flash("GO CJ!");
        this._lastPassCheerAt = this.raceTime;
      }
    }
  }

  _frame(now) {
    if (!this._running) return;
    let dt = (now - this._last) / 1000;
    this._last = now;
    dt = Math.min(dt, 0.05);

    if (this.state === "countdown") {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.countdown -= 1;
        this.countdownTimer = 1;
        if (this.countdown > 0) {
          this.audio.beep("count");
          if (this.opts.onCountdown) this.opts.onCountdown(this.countdown);
        } else if (this.countdown === 0) {
          this.audio.beep("go");
          this.state = "racing";
          this.raceTime = 0;
          for (const c of this.cars) c.lapStart = 0;
          if (this.opts.onCountdown) this.opts.onCountdown("GO");
          // Opening roar
          setTimeout(() => {
            if (this.state === "racing" && this.audio.enabled) {
              this.audio.chant("CJ");
              this._flash("GO CJ!");
            }
          }, 700);
        } else if (this.opts.onCountdown) this.opts.onCountdown(null);
      }
    }

    if (this.state === "racing") this.raceTime += dt;

    if (this.state === "racing" || this.state === "countdown" || this.state === "finished") {
      for (const car of this.cars) this._updateCar(car, dt);
      if (this.state === "racing") this._carCollisions();
      this._updateDust(dt);
    }

    this._updateCrowdChants(dt);

    for (let i = 0; i < this.cars.length; i++) {
      if (this.carMeshes[i]) this._syncCarMesh(this.cars[i], this.carMeshes[i]);
    }

    this._updateCamera(dt);
    this._updateAudio();
    this._updateHud();

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    this._raf = requestAnimationFrame((t) => this._frame(t));
  }
}

export { formatTime };
