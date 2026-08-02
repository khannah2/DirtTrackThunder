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
function formatTime(t) {
  if (t == null || !isFinite(t)) return "--:--.--";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function shadeHex(hex, amt) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return hex || "#888";
  const n = parseInt(hex.slice(1, 7), 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0xff) + amt;
  let b = (n & 0xff) + amt;
  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function lerpAngle(a, b, t) {
  return a + normAngle(b - a) * t;
}

/** Canvas texture for trackside sponsor boards (crisp text) */
function makeSponsorBoard({ title, sub, tag, bg, accent, fg }) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = accent;
  g.fillRect(0, 0, 512, 14);
  g.fillRect(0, 242, 512, 14);
  g.fillRect(0, 0, 10, 256);
  g.fillRect(502, 0, 10, 256);
  g.fillStyle = fg;
  g.font = "bold 48px Bebas Neue, Impact, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(title, 256, 90);
  g.font = "bold 36px Bebas Neue, Impact, sans-serif";
  g.fillStyle = accent;
  g.fillText(sub, 256, 140);
  g.font = "600 20px Rajdhani, sans-serif";
  g.fillStyle = fg;
  g.globalAlpha = 0.85;
  g.fillText(tag, 256, 195);
  g.globalAlpha = 1;
  return c;
}

/** Procedural clay / dirt surface (packed groove + cushion tones) */
function makeDirtTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#6b4226";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const v = Math.random();
    g.fillStyle =
      v > 0.6
        ? `rgba(120,75,40,${0.15 + Math.random() * 0.25})`
        : `rgba(40,22,10,${0.08 + Math.random() * 0.2})`;
    g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // tire groove streaks
  g.strokeStyle = "rgba(35,18,8,0.22)";
  g.lineWidth = 3;
  for (let y = 20; y < 240; y += 14 + Math.random() * 10) {
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x < 256; x += 8) {
      g.lineTo(x, y + Math.sin(x * 0.08 + y) * 2);
    }
    g.stroke();
  }
  return c;
}

function makeGrassTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#2a4a1c";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1200; i++) {
    g.strokeStyle = `rgba(${20 + Math.random() * 40},${60 + Math.random() * 50},${15 + Math.random() * 20},${0.25 + Math.random() * 0.4})`;
    g.lineWidth = 1;
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 3, y - 4 - Math.random() * 6);
    g.stroke();
  }
  return c;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Lane banking height — outer cushion sits higher like a real short track */
function laneHeight(lane) {
  return lane * 0.55;
}

/** Stadium oval track in world units */
const TRACK = {
  cx: 0,
  cy: 0,
  outerRx: 95,
  outerRy: 58,
  innerRx: 52,
  innerRy: 24,
  wallH: 2.6,
  // Collision inset so the driveable lane is slightly inside painted walls
  collideOuter: 0.97,
  collideInner: 1.04,
};

export class RaceSession {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = options;
    this.audio = new RaceAudio();
    this.keys = Object.create(null);
    this.state = "ready"; // ready | countdown | racing | finished
    this.cars = [];
    this.player = null;
    this.particles = [];
    this.raceTime = 0;
    this.bestLap = null;
    this.countdown = 3;
    this.countdownTimer = 0;
    this.message = "";
    this.messageTimer = 0;
    this.lookBack = false;
    this._boundKeyDown = (e) => this._onKey(e, true);
    this._boundKeyUp = (e) => this._onKey(e, false);
    this._raf = 0;
    this._last = 0;
    this._running = false;
    this.onFinish = options.onFinish || (() => {});
    this.onQuit = options.onQuit || (() => {});
    this.hud = options.hud || {};
  }

  start() {
    this._buildField();
    this._initBillboards();
    this._initVisuals();
    this.state = "ready";
    this.raceTime = 0;
    this.bestLap = null;
    this.particles = [];
    this._running = true;
    this._last = performance.now();
    this._wallCooldown = 0;
    window.addEventListener("keydown", this._boundKeyDown);
    window.addEventListener("keyup", this._boundKeyUp);
    // Avoid stuck keys if window loses focus mid-press
    window.addEventListener("blur", () => {
      for (const k of Object.keys(this.keys)) this.keys[k] = false;
    });
    this._raf = requestAnimationFrame((t) => this._frame(t));
    this._draw();
  }

  _initVisuals() {
    this.dirtTex = makeDirtTexture();
    this.grassTex = makeGrassTexture();
    this.carSprites = Object.create(null);
    // Preload real car photos for in-race sprites
    const urls = new Set();
    for (const c of this.cars) {
      const src = c.driver.portrait || c.driver.action;
      if (src) urls.add(src);
    }
    if (PLAYER.portrait) urls.add(PLAYER.portrait);
    if (PLAYER.action) urls.add(PLAYER.action);
    for (const src of urls) {
      loadImage(src).then((img) => {
        if (img) this.carSprites[src] = img;
      });
    }
  }

  _initBillboards() {
    this.billboardTex = {
      pawn: makeSponsorBoard({
        title: "COLORADO PAWN",
        sub: "& JEWELRY",
        tag: "BUY · SELL · LOANS",
        bg: "#0d3b2c",
        accent: "#f0b429",
        fg: "#ffffff",
      }),
      permann: makeSponsorBoard({
        title: "PERMANN",
        sub: "DIESEL SOLUTIONS",
        tag: "CJ #37 · DYLAN #777",
        bg: "#141414",
        accent: "#3d9e3a",
        fg: "#f5e6c8",
      }),
      pawn2: makeSponsorBoard({
        title: "COLORADO PAWN",
        sub: "& JEWELRY",
        tag: "TRACKSIDE PARTNER",
        bg: "#102a22",
        accent: "#e85d04",
        fg: "#fff",
      }),
      permann2: makeSponsorBoard({
        title: "PERMANN DIESEL",
        sub: "SOLUTIONS",
        tag: "HOOSIER · DYLAN #777",
        bg: "#1a1208",
        accent: "#e85d04",
        fg: "#fff8e7",
      }),
    };

    // Placed outside the outer wall, facing the track
    const specs = [
      { t: 0.35, brand: "pawn", h: 5.5, w: 10, elev: 1.2 },
      { t: 1.1, brand: "permann", h: 5.2, w: 11, elev: 1.1 },
      { t: 2.0, brand: "pawn2", h: 5.0, w: 9.5, elev: 1.3 },
      { t: 2.9, brand: "permann2", h: 5.5, w: 10.5, elev: 1.15 },
      { t: 3.9, brand: "pawn", h: 4.8, w: 9, elev: 1.0 },
      { t: 5.0, brand: "permann", h: 5.3, w: 10, elev: 1.25 },
      { t: 5.7, brand: "pawn2", h: 5.0, w: 10, elev: 1.1 },
    ];

    this.billboards = specs.map((s) => {
      const ang = Math.PI / 2 - s.t;
      // Outside outer ellipse
      const rx = TRACK.outerRx + 8;
      const ry = TRACK.outerRy + 7;
      const x = TRACK.cx + Math.cos(ang) * rx;
      const y = TRACK.cy + Math.sin(ang) * ry;
      // Face toward track center
      const face = Math.atan2(TRACK.cy - y, TRACK.cx - x);
      return {
        x,
        y,
        face,
        w: s.w,
        h: s.h,
        elev: s.elev,
        tex: this.billboardTex[s.brand],
      };
    });
  }

  async greenFlag() {
    await this.audio.resume();
    this.state = "countdown";
    this.countdown = 3;
    this.countdownTimer = 1;
    this.audio.beep("count");
    if (this.opts.onCountdown) this.opts.onCountdown(3);
  }

  destroy() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._boundKeyDown);
    window.removeEventListener("keyup", this._boundKeyUp);
    this.audio.stopAll();
  }

  _onKey(e, down) {
    this.keys[e.code] = down;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (down && e.code === "Escape" && this.state !== "finished") {
      this.destroy();
      this.onQuit();
    }
    if (e.code === "KeyC") this.lookBack = down;
  }

  _pressed(code) {
    return !!this.keys[code];
  }

  _buildField() {
    const laps = this.opts.laps || 8;
    const stats = this.opts.playerStats || {
      power: 1,
      grip: 1,
      handling: 1,
      brakes: 1,
      aero: 1,
    };
    const rivals = this.opts.rivals || [];
    this.cars = [];

    // Grid near finish (bottom of oval), staggered
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
      const p = this._linePoint(prog, lane);
      const heading = this._lineHeading(prog);
      const d = entry.driver;
      this.cars.push({
        driver: d,
        isPlayer: !!d.isPlayer,
        x: p.x,
        y: p.y,
        z: 0,
        angle: heading,
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
        accel: 28 * entry.stats.power,
        grip: 1.1 * entry.stats.grip,
        turn: 2.4 * entry.stats.handling,
        brakePower: 42 * entry.stats.brakes,
        skill: d.skill || 1,
        aggression: d.aggression || 0.5,
        aiLane: lane,
        width: 1.9,
        length: 4.4,
        crashed: 0,
      });
    });

    this.player = this.cars.find((c) => c.isPlayer);
    this.totalLaps = laps;
  }

  // --- Track geometry ---
  _linePoint(progress, lane = 0.45) {
    // progress 0..TAU clockwise from finish (bottom, +Y)
    const ang = Math.PI / 2 - progress;
    const rx = lerp(TRACK.innerRx, TRACK.outerRx, lane);
    const ry = lerp(TRACK.innerRy, TRACK.outerRy, lane);
    return {
      x: TRACK.cx + Math.cos(ang) * rx,
      y: TRACK.cy + Math.sin(ang) * ry,
    };
  }

  _lineHeading(progress) {
    const a = this._linePoint(progress, 0.45);
    const b = this._linePoint(progress + 0.04, 0.45);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  _progressAt(x, y) {
    const ang = Math.atan2(y - TRACK.cy, x - TRACK.cx);
    let p = Math.PI / 2 - ang;
    while (p < 0) p += TAU;
    while (p >= TAU) p -= TAU;
    return p;
  }

  _radial(x, y, rx, ry) {
    const dx = (x - TRACK.cx) / rx;
    const dy = (y - TRACK.cy) / ry;
    return Math.hypot(dx, dy);
  }

  _onTrack(x, y) {
    return this._radial(x, y, TRACK.outerRx, TRACK.outerRy) <= 1 &&
      this._radial(x, y, TRACK.innerRx, TRACK.innerRy) >= 1;
  }

  // --- Update ---
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
        } else if (this.opts.onCountdown) {
          this.opts.onCountdown(null);
        }
      }
    }

    if (this.state === "racing") this.raceTime += dt;

    if (this.state === "racing" || this.state === "countdown" || this.state === "finished") {
      for (const c of this.cars) this._updateCar(c, dt);
      if (this.state === "racing") this._carCollisions();
      this._updateParticles(dt);
    }

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0 && this.opts.onFlash) this.opts.onFlash(null);
    }

    this._updateAudio();
    this._updateHud();
    this._draw();
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  _updateCar(car, dt) {
    if (car.finished) {
      car.speed = lerp(car.speed, 0, 1.5 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      this._resolveWalls(car);
      return;
    }
    if (car.crashed > 0) car.crashed -= dt;

    if (car.isPlayer && this.state === "racing") {
      car.throttle = this._pressed("KeyW") || this._pressed("ArrowUp") ? 1 : 0;
      car.brake = this._pressed("KeyS") || this._pressed("ArrowDown") ? 1 : 0;
      car.steer = 0;
      if (this._pressed("KeyA") || this._pressed("ArrowLeft")) car.steer -= 1;
      if (this._pressed("KeyD") || this._pressed("ArrowRight")) car.steer += 1;
      car.handbrake = this._pressed("Space") ? 1 : 0;
    } else if (!car.isPlayer && this.state === "racing") {
      this._ai(car, dt);
    } else {
      car.throttle = car.brake = car.steer = car.handbrake = 0;
    }

    const onDirt = this._onTrack(car.x, car.y);
    const surface = onDirt ? 1 : 0.55;
    const grip = car.grip * surface * (car.handbrake ? 0.5 : 1);

    // Steer only when actually rolling; reverse inverts steer like a real car
    const rolling = Math.abs(car.speed) > 0.35;
    const steerDir = car.speed >= 0 ? 1 : -1;
    const steerEff =
      car.turn * (0.28 + clamp(Math.abs(car.speed) / 20, 0, 1)) *
      (1 - clamp(Math.abs(car.slip) / 2.5, 0, 0.4));
    if (rolling) {
      car.angle += car.steer * steerEff * steerDir * dt;
    }

    // Engine / brakes — throttle always wins over mild drag so you can't "stall" mid-corner
    if (car.throttle) {
      const pull = car.accel * (0.85 + (1 - clamp(Math.abs(car.speed) / car.maxSpeed, 0, 1)) * 0.35);
      car.speed += pull * car.throttle * dt;
    }
    if (car.brake) {
      if (car.speed > 1.5) car.speed -= car.brakePower * car.brake * dt;
      else car.speed -= 14 * car.brake * dt;
    }

    // Rolling resistance (gentler; was stacking with wall hits and zeroing speed)
    const drag = car.throttle ? 0.18 : 0.38;
    car.speed -= car.speed * (drag + (1 - grip) * 0.2) * dt;
    if (!car.throttle && !car.brake) car.speed -= car.speed * 0.22 * dt;

    const maxSpd = car.maxSpeed * (onDirt ? 1 : 0.65) * (1 + (car.stats.aero - 1) * 0.3);
    car.speed = clamp(car.speed, -8, maxSpd);

    // Keep a crawl while gas is held so wall scrapes can't pin you at 0
    if (car.throttle && car.speed >= 0 && car.speed < 2.5) {
      car.speed = Math.max(car.speed, 2.5 * car.throttle);
    }

    // Slip only builds with steering at speed (straight throttle = straight ahead)
    const slipWant =
      car.steer *
      clamp((Math.abs(car.speed) - 6) / 20, 0, 1) *
      (car.handbrake ? 1.45 : 0.8);
    car.slip = lerp(car.slip, slipWant, (car.handbrake ? 3.2 : 1.8) * dt);
    car.slip *= 1 - grip * 2.0 * dt;
    if (Math.abs(car.steer) < 0.05 && !car.handbrake) {
      car.slip *= 1 - 7 * dt;
    }

    // Motion along heading + light lateral drift
    const forward = car.speed * dt;
    const lateral = car.speed * car.slip * 0.25 * dt;
    car.x += Math.cos(car.angle) * forward + Math.cos(car.angle + Math.PI / 2) * lateral;
    car.y += Math.sin(car.angle) * forward + Math.sin(car.angle + Math.PI / 2) * lateral;

    this._resolveWalls(car, dt);

    if (onDirt && Math.abs(car.speed) > 12 && (Math.abs(car.slip) > 0.2 || car.handbrake)) {
      if (Math.random() < 0.5) {
        this.particles.push({
          x: car.x - Math.cos(car.angle) * 2,
          y: car.y - Math.sin(car.angle) * 2,
          z: 0.2,
          vx: -Math.cos(car.angle) * 2 + (Math.random() - 0.5) * 3,
          vy: -Math.sin(car.angle) * 2 + (Math.random() - 0.5) * 3,
          vz: 1 + Math.random() * 2,
          life: 0.5 + Math.random() * 0.4,
          size: 0.4 + Math.random() * 0.6,
        });
      }
    }

    this._updateProgress(car);
  }

  _resolveWalls(car, dt = 0.016) {
    // Soft ellipse walls: push back onto track without killing throttle every frame
    let impact = 0;
    const of = this._radial(car.x, car.y, TRACK.outerRx, TRACK.outerRy);
    if (of > TRACK.collideOuter) {
      const ang = Math.atan2(car.y - TRACK.cy, car.x - TRACK.cx);
      // Outward normal on ellipse (approx)
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      const target = TRACK.collideOuter * 0.995;
      car.x = TRACK.cx + Math.cos(ang) * TRACK.outerRx * target;
      car.y = TRACK.cy + Math.sin(ang) * TRACK.outerRy * target;

      // Remove only the outward velocity component; keep tangential speed
      const vx = Math.cos(car.angle) * car.speed;
      const vy = Math.sin(car.angle) * car.speed;
      const vn = vx * nx + vy * ny;
      if (vn > 0) {
        const rx = vx - vn * nx * 1.05;
        const ry = vy - vn * ny * 1.05;
        car.speed = Math.hypot(rx, ry) * Math.sign(car.speed || 1);
        // Align heading a bit with remaining velocity so you slide along the cushion
        if (car.speed > 3) {
          const want = Math.atan2(ry, rx);
          car.angle = lerpAngle(car.angle, want, 0.35);
        }
        impact = clamp(vn / 25, 0, 1);
        car.slip += clamp(vn * 0.02, -0.4, 0.4);
      } else {
        // Scraping while already parallel — light scrub only
        car.speed *= 1 - 0.15 * dt;
      }
    }

    const inf = this._radial(car.x, car.y, TRACK.innerRx, TRACK.innerRy);
    if (inf < TRACK.collideInner) {
      const ang = Math.atan2(car.y - TRACK.cy, car.x - TRACK.cx);
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      car.x = TRACK.cx + Math.cos(ang) * TRACK.innerRx * TRACK.collideInner;
      car.y = TRACK.cy + Math.sin(ang) * TRACK.innerRy * TRACK.collideInner;

      const vx = Math.cos(car.angle) * car.speed;
      const vy = Math.sin(car.angle) * car.speed;
      // Inner wall normal points inward toward center; push outward = -n
      const vn = vx * (-nx) + vy * (-ny);
      if (vn > 0) {
        const rx = vx - vn * (-nx) * 1.05;
        const ry = vy - vn * (-ny) * 1.05;
        car.speed = Math.hypot(rx, ry) * Math.sign(car.speed || 1);
        if (car.speed > 3) {
          const want = Math.atan2(ry, rx);
          car.angle = lerpAngle(car.angle, want, 0.3);
        }
        impact = Math.max(impact, clamp(vn / 28, 0, 1));
      } else {
        car.speed *= 1 - 0.12 * dt;
      }
    }

    if (impact > 0.2 && car.isPlayer) {
      this.audio.impact(impact);
    }
  }

  _updateProgress(car) {
    const p = this._progressAt(car.x, car.y);
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
      } else {
        car.lapStart = this.raceTime;
      }
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
    const lane = clamp(car.aiLane + car.speed / 80 * 0.1, 0.28, 0.72);
    const target = this._linePoint(targetT, lane);
    const desired = Math.atan2(target.y - car.y, target.x - car.x);
    let err = normAngle(desired - car.angle);
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
          if (Math.abs(rel) > 1.5) {
            if (a.isPlayer || b.isPlayer) this.audio.impact(clamp(Math.abs(rel) / 8, 0.2, 1));
          }
        }
      }
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= 6 * dt;
      if (p.z < 0) p.z = 0;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    if (this.particles.length > 200) this.particles.splice(0, this.particles.length - 200);
  }

  _updateAudio() {
    if (!this.player) return;
    const sp = clamp(Math.abs(this.player.speed) / this.player.maxSpeed, 0, 1);
    const slip = clamp(Math.abs(this.player.slip) / 1.2, 0, 1);
    this.audio.update(sp, this.player.throttle, slip, this._onTrack(this.player.x, this.player.y));
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
    if (n === 1) return "st";
    if (n === 2) return "nd";
    if (n === 3) return "rd";
    return "th";
  }

  _flash(text) {
    this.message = text;
    this.messageTimer = 1.2;
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
    if (h.speed) {
      // world units -> display mph (tuned)
      h.speed.textContent = String(Math.max(0, Math.round(Math.abs(this.player.speed) * 4.2)));
    }
    if (h.best) h.best.textContent = formatTime(this.bestLap);
    if (h.tach) {
      const rpm = clamp(Math.abs(this.player.speed) / this.player.maxSpeed, 0, 1);
      h.tach.style.width = `${Math.round((0.15 + rpm * 0.85 + this.player.throttle * 0.1) * 100)}%`;
    }
  }

  /**
   * World → camera → screen.
   * Camera looks along car.angle (forward = cos/sin of yaw).
   * Previously right/forward axes were swapped, which made throttle feel sideways.
   */
  _project(wx, wy, wz, cam, yaw, eyeH, W, H) {
    const dx = wx - cam.x;
    const dy = wy - cam.y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // Camera-local: +forward ahead, +right to the right
    const forward = dx * cos + dy * sin;
    const right = -dx * sin + dy * cos;
    const up = wz - eyeH;
    if (forward < 0.85) return null;
    const fov = 380;
    const scale = fov / forward;
    return {
      x: W / 2 + right * scale,
      y: H * 0.5 - up * scale,
      scale,
      depth: forward,
    };
  }

  // --- First-person render ---
  _draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const cam = this.player;
    if (!cam) return;

    const eyeH = 1.15;
    // Camera follows car heading; slight lean into slip for dirt feel
    let yaw = cam.angle + cam.slip * 0.1;
    if (this.lookBack) yaw += Math.PI;

    // Night sky + stadium haze
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.52);
    sky.addColorStop(0, "#05070e");
    sky.addColorStop(0.4, "#0c1424");
    sky.addColorStop(0.75, "#1a2030");
    sky.addColorStop(1, "#3d2e1a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H * 0.52);

    // Stars
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 97) % W);
      const sy = ((i * 53) % (H * 0.28));
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }

    // Flood light blooms
    for (const [lx, ly] of [[0.15, 0.1], [0.85, 0.1], [0.3, 0.08], [0.7, 0.08]]) {
      const g = ctx.createRadialGradient(W * lx, H * ly, 4, W * lx, H * ly, 90);
      g.addColorStop(0, "rgba(255,240,180,0.35)");
      g.addColorStop(0.4, "rgba(255,220,120,0.08)");
      g.addColorStop(1, "rgba(255,200,80,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(W * lx, H * ly, 90, 0, TAU);
      ctx.fill();
    }

    // Distant tree line / dark treeline silhouette
    ctx.fillStyle = "#0a1208";
    ctx.beginPath();
    ctx.moveTo(0, H * 0.48);
    for (let x = 0; x <= W; x += 24) {
      const h = 8 + Math.sin(x * 0.04) * 6 + Math.sin(x * 0.11) * 4;
      ctx.lineTo(x, H * 0.48 - h);
    }
    ctx.lineTo(W, H * 0.52);
    ctx.lineTo(0, H * 0.52);
    ctx.closePath();
    ctx.fill();

    // Ground fill (grass beyond track)
    ctx.fillStyle = "#1e3a16";
    ctx.fillRect(0, H * 0.5, W, H * 0.5);

    const project = (wx, wy, wz) => this._project(wx, wy, wz, cam, yaw, eyeH, W, H);

    this._drawTrack(ctx, project, W, H);
    this._drawBillboards(ctx, project);
    this._drawDust(ctx, project);

    // Other cars (depth sort)
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const others = this.cars
      .filter((c) => c !== cam)
      .map((c) => {
        const dx = c.x - cam.x;
        const dy = c.y - cam.y;
        const depth = dx * cosY + dy * sinY;
        return { c, depth };
      })
      .filter((o) => o.depth > 1.2 && o.depth < 120)
      .sort((a, b) => b.depth - a.depth);

    for (const { c } of others) this._drawCarFP(ctx, c, project, yaw);

    this._drawCockpit(ctx, W, H, cam);

    // Warm flood-light wash over the scene
    const wash = ctx.createRadialGradient(W / 2, H * 0.35, 40, W / 2, H * 0.55, H * 0.7);
    wash.addColorStop(0, "rgba(255,210,120,0.04)");
    wash.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);

    // Edge vignette
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.18, W / 2, H / 2, H * 0.78);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  _drawDust(ctx, project) {
    for (const p of this.particles) {
      const pr = project(p.x, p.y, p.z);
      if (!pr) continue;
      const a = clamp(p.life * 1.1, 0, 0.5);
      const r = p.size * pr.scale * 0.55;
      const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, r);
      g.addColorStop(0, `rgba(190,150,100,${a})`);
      g.addColorStop(1, `rgba(100,70,40,0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, r, 0, TAU);
      ctx.fill();
    }
  }

  _drawBillboards(ctx, project) {
    if (!this.billboards || !this.billboards.length) return;

    // Depth-sort so nearer boards draw last
    const drawn = [];
    for (const b of this.billboards) {
      const mid = project(b.x, b.y, b.elev + b.h * 0.5);
      if (!mid || mid.depth < 4 || mid.depth > 110) continue;
      drawn.push({ b, depth: mid.depth });
    }
    drawn.sort((a, c) => c.depth - a.depth);

    for (const { b } of drawn) {
      const cos = Math.cos(b.face);
      const sin = Math.sin(b.face);
      // Board plane: horizontal axis perpendicular to face direction
      const hx = -sin * (b.w * 0.5);
      const hy = cos * (b.w * 0.5);
      const z0 = b.elev;
      const z1 = b.elev + b.h;
      const corners = [
        project(b.x - hx, b.y - hy, z0),
        project(b.x + hx, b.y + hy, z0),
        project(b.x + hx, b.y + hy, z1),
        project(b.x - hx, b.y - hy, z1),
      ];
      if (corners.some((p) => !p)) continue;

      // Post
      const post = project(b.x, b.y, 0);
      const postTop = project(b.x, b.y, z0);
      if (post && postTop) {
        ctx.strokeStyle = "#3a3a3a";
        ctx.lineWidth = Math.max(2, 6 * (18 / post.depth));
        ctx.beginPath();
        ctx.moveTo(post.x, post.y);
        ctx.lineTo(postTop.x, postTop.y);
        ctx.stroke();
      }

      // Textured quad via transform approximation (affine)
      const [p0, p1, p2, p3] = corners;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.clip();

      // Draw image stretched across bounding box (good enough for boards)
      const minX = Math.min(p0.x, p1.x, p2.x, p3.x);
      const maxX = Math.max(p0.x, p1.x, p2.x, p3.x);
      const minY = Math.min(p0.y, p1.y, p2.y, p3.y);
      const maxY = Math.max(p0.y, p1.y, p2.y, p3.y);
      if (b.tex) {
        ctx.drawImage(b.tex, minX, minY, maxX - minX, maxY - minY);
      } else {
        ctx.fillStyle = "#222";
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      }
      ctx.restore();

      // Frame
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  _drawTrack(ctx, project, W, H) {
    const segs = 80;
    const lanes = [0.02, 0.18, 0.34, 0.5, 0.66, 0.82, 0.98];

    // Infield grass disc (projected ring of quads)
    for (let i = 0; i < 36; i++) {
      const t0 = (i / 36) * TAU;
      const t1 = ((i + 1) / 36) * TAU;
      const r0 = 0.15;
      const r1 = 0.95;
      const ang0 = Math.PI / 2 - t0;
      const ang1 = Math.PI / 2 - t1;
      const pts = [
        { x: TRACK.cx + Math.cos(ang0) * TRACK.innerRx * r0, y: TRACK.cy + Math.sin(ang0) * TRACK.innerRy * r0 },
        { x: TRACK.cx + Math.cos(ang1) * TRACK.innerRx * r0, y: TRACK.cy + Math.sin(ang1) * TRACK.innerRy * r0 },
        { x: TRACK.cx + Math.cos(ang1) * TRACK.innerRx * r1, y: TRACK.cy + Math.sin(ang1) * TRACK.innerRy * r1 },
        { x: TRACK.cx + Math.cos(ang0) * TRACK.innerRx * r1, y: TRACK.cy + Math.sin(ang0) * TRACK.innerRy * r1 },
      ].map((q) => project(q.x, q.y, 0));
      if (pts.some((p) => !p)) continue;
      ctx.fillStyle = i % 2 === 0 ? "#2f5522" : "#274a1c";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < 4; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath();
      ctx.fill();
    }

    // Dirt surface with banking + cushion/groove color split
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * TAU;
      const t1 = ((i + 1) / segs) * TAU;
      for (let L = 0; L < lanes.length - 1; L++) {
        const la = lanes[L];
        const lb = lanes[L + 1];
        const a = this._linePoint(t0, la);
        const b = this._linePoint(t1, la);
        const c = this._linePoint(t1, lb);
        const d = this._linePoint(t0, lb);
        const za = laneHeight(la);
        const zb = laneHeight(lb);
        const p = [
          project(a.x, a.y, za),
          project(b.x, b.y, za),
          project(c.x, c.y, zb),
          project(d.x, d.y, zb),
        ];
        if (p.some((x) => !x)) continue;

        // Inner groove darker/wetter; outer cushion lighter/drier clay
        const midLane = (la + lb) * 0.5;
        const groove = midLane < 0.4 ? 1 : midLane > 0.72 ? 0 : 0.5;
        const baseR = groove > 0.7 ? 72 : midLane > 0.72 ? 120 : 95;
        const baseG = groove > 0.7 ? 48 : midLane > 0.72 ? 78 : 62;
        const baseB = groove > 0.7 ? 28 : midLane > 0.72 ? 42 : 32;
        const band = (i + L) % 3 === 0 ? 8 : 0;
        const light = 1 + Math.sin(t0 * 3) * 0.04;
        ctx.fillStyle = `rgb(${(baseR + band) * light | 0},${(baseG + band * 0.6) * light | 0},${baseB | 0})`;
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y);
        ctx.lineTo(p[1].x, p[1].y);
        ctx.lineTo(p[2].x, p[2].y);
        ctx.lineTo(p[3].x, p[3].y);
        ctx.closePath();
        ctx.fill();

        // tire groove hairlines
        if (L === 2 || L === 4) {
          ctx.strokeStyle = "rgba(30,15,8,0.18)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p[0].x, p[0].y);
          ctx.lineTo(p[1].x, p[1].y);
          ctx.stroke();
        }
      }
    }

    // Finish line checkers across track at progress ~0
    for (let L = 0; L < 8; L++) {
      const la = L / 8;
      const lb = (L + 1) / 8;
      const a = this._linePoint(-0.02, la);
      const b = this._linePoint(0.02, la);
      const c = this._linePoint(0.02, lb);
      const d = this._linePoint(-0.02, lb);
      const z = laneHeight((la + lb) * 0.5) + 0.02;
      const p = [a, b, c, d].map((q) => project(q.x, q.y, z));
      if (p.some((x) => !x)) continue;
      ctx.fillStyle = L % 2 === 0 ? "#111" : "#f2f2f2";
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      ctx.lineTo(p[1].x, p[1].y);
      ctx.lineTo(p[2].x, p[2].y);
      ctx.lineTo(p[3].x, p[3].y);
      ctx.closePath();
      ctx.fill();
    }

    // Outer concrete wall + red/white blocks
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * TAU;
      const t1 = ((i + 1) / segs) * TAU;
      const ang0 = Math.PI / 2 - t0;
      const ang1 = Math.PI / 2 - t1;
      const A = {
        x: TRACK.cx + Math.cos(ang0) * TRACK.outerRx,
        y: TRACK.cy + Math.sin(ang0) * TRACK.outerRy,
      };
      const B = {
        x: TRACK.cx + Math.cos(ang1) * TRACK.outerRx,
        y: TRACK.cy + Math.sin(ang1) * TRACK.outerRy,
      };
      const zWall = laneHeight(1) + TRACK.wallH;
      const p0 = project(A.x, A.y, laneHeight(1));
      const p1 = project(B.x, B.y, laneHeight(1));
      const p2 = project(B.x, B.y, zWall);
      const p3 = project(A.x, A.y, zWall);
      if (!p0 || !p1 || !p2 || !p3) continue;
      // concrete base
      ctx.fillStyle = i % 2 === 0 ? "#b8b8b8" : "#9a9a9a";
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();
      // SAFER-style top stripe
      const midZ = laneHeight(1) + TRACK.wallH * 0.72;
      const t0b = project(A.x, A.y, midZ);
      const t1b = project(B.x, B.y, midZ);
      if (t0b && t1b && p2 && p3) {
        ctx.fillStyle = i % 2 === 0 ? "#d62828" : "#f0f0f0";
        ctx.beginPath();
        ctx.moveTo(t0b.x, t0b.y);
        ctx.lineTo(t1b.x, t1b.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Catch fence posts + wire
    for (let i = 0; i < segs; i += 2) {
      const t = (i / segs) * TAU;
      const ang = Math.PI / 2 - t;
      const x = TRACK.cx + Math.cos(ang) * (TRACK.outerRx + 0.4);
      const y = TRACK.cy + Math.sin(ang) * (TRACK.outerRy + 0.4);
      const base = project(x, y, laneHeight(1) + TRACK.wallH);
      const top = project(x, y, laneHeight(1) + TRACK.wallH + 2.4);
      if (!base || !top) continue;
      ctx.strokeStyle = "rgba(180,180,190,0.55)";
      ctx.lineWidth = Math.max(1, 2.5 * (20 / base.depth));
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }
    // Horizontal fence cables
    for (let h = 0; h < 3; h++) {
      ctx.strokeStyle = "rgba(200,200,210,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * TAU;
        const ang = Math.PI / 2 - t;
        const x = TRACK.cx + Math.cos(ang) * (TRACK.outerRx + 0.4);
        const y = TRACK.cy + Math.sin(ang) * (TRACK.outerRy + 0.4);
        const p = project(x, y, laneHeight(1) + TRACK.wallH + 0.6 + h * 0.7);
        if (!p) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Inner tire barrier / curb
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * TAU;
      const t1 = ((i + 1) / segs) * TAU;
      const ang0 = Math.PI / 2 - t0;
      const ang1 = Math.PI / 2 - t1;
      const A = {
        x: TRACK.cx + Math.cos(ang0) * TRACK.innerRx,
        y: TRACK.cy + Math.sin(ang0) * TRACK.innerRy,
      };
      const B = {
        x: TRACK.cx + Math.cos(ang1) * TRACK.innerRx,
        y: TRACK.cy + Math.sin(ang1) * TRACK.innerRy,
      };
      const p0 = project(A.x, A.y, 0);
      const p1 = project(B.x, B.y, 0);
      const p2 = project(B.x, B.y, 0.55);
      const p3 = project(A.x, A.y, 0.55);
      if (!p0 || !p1 || !p2 || !p3) continue;
      ctx.fillStyle = i % 2 === 0 ? "#e8b923" : "#1a1a1a";
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();
    }

    // Flood light poles (4 corners of venue)
    const poles = [
      { x: -TRACK.outerRx - 12, y: -TRACK.outerRy - 8 },
      { x: TRACK.outerRx + 12, y: -TRACK.outerRy - 8 },
      { x: -TRACK.outerRx - 12, y: TRACK.outerRy + 8 },
      { x: TRACK.outerRx + 12, y: TRACK.outerRy + 8 },
    ];
    for (const pole of poles) {
      const base = project(pole.x, pole.y, 0);
      const top = project(pole.x, pole.y, 9);
      if (!base || !top) continue;
      ctx.strokeStyle = "#555";
      ctx.lineWidth = Math.max(2, 5 * (25 / base.depth));
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      // lamp head
      ctx.fillStyle = "rgba(255,240,180,0.9)";
      ctx.beginPath();
      ctx.ellipse(top.x, top.y, 10 * (25 / top.depth), 4 * (25 / top.depth), 0, 0, TAU);
      ctx.fill();
      const glow = ctx.createRadialGradient(top.x, top.y, 2, top.x, top.y + 30, 80 * (30 / top.depth));
      glow.addColorStop(0, "rgba(255,230,150,0.2)");
      glow.addColorStop(1, "rgba(255,200,100,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(top.x, top.y + 20, 70 * (30 / Math.max(top.depth, 10)), 0, TAU);
      ctx.fill();
    }

    // Simple bleacher blocks outside long straights
    this._drawBleacher(ctx, project, 0, -TRACK.outerRy - 14, 28, 6, 4);
    this._drawBleacher(ctx, project, 0, TRACK.outerRy + 14, 28, 6, 4);
  }

  _drawBleacher(ctx, project, x, y, w, d, h) {
    const corners = [
      [x - w / 2, y - d / 2, 0],
      [x + w / 2, y - d / 2, 0],
      [x + w / 2, y + d / 2, 0],
      [x - w / 2, y + d / 2, 0],
      [x - w / 2, y - d / 2, h],
      [x + w / 2, y - d / 2, h],
      [x + w / 2, y + d / 2, h],
      [x - w / 2, y + d / 2, h],
    ].map(([wx, wy, wz]) => project(wx, wy, wz));
    if (corners.some((p) => !p)) return;
    const face = (idx, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(corners[idx[0]].x, corners[idx[0]].y);
      for (let i = 1; i < idx.length; i++) ctx.lineTo(corners[idx[i]].x, corners[idx[i]].y);
      ctx.closePath();
      ctx.fill();
    };
    face([0, 1, 5, 4], "#3a3a42");
    face([1, 2, 6, 5], "#2e2e36");
    face([4, 5, 6, 7], "#4a4a55");
    // crowd dots
    for (let i = 0; i < 12; i++) {
      const u = (i % 6) / 5;
      const v = Math.floor(i / 6) / 2;
      const px = x - w / 2 + u * w;
      const py = y - d / 2 + 1;
      const pz = 1 + v * (h - 1.2);
      const pr = project(px, py, pz);
      if (!pr) continue;
      ctx.fillStyle = `hsl(${(i * 40) % 360},45%,55%)`;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, 2.2 * (22 / pr.depth), 0, TAU);
      ctx.fill();
    }
  }

  _drawCarFP(ctx, car, project, camYaw) {
    const d = car.driver;
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    const hw = car.width * 0.5;
    const hl = car.length * 0.5;
    const bodyH = 1.15;
    const roofH = 1.5;

    // Ground shadow
    const shadowPts = [
      { x: -hl * 0.9, y: -hw * 0.9 },
      { x: hl * 0.9, y: -hw * 0.9 },
      { x: hl * 0.9, y: hw * 0.9 },
      { x: -hl * 0.9, y: hw * 0.9 },
    ].map((c) => {
      const wx = car.x + c.x * cos - c.y * sin;
      const wy = car.y + c.x * sin + c.y * cos;
      return project(wx, wy, 0.02);
    });
    if (shadowPts.every(Boolean)) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.moveTo(shadowPts[0].x, shadowPts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(shadowPts[i].x, shadowPts[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // Chassis mesh (under / around photo)
    const local = [
      { x: -hl, y: -hw, z: 0.08 },
      { x: hl, y: -hw, z: 0.08 },
      { x: hl, y: hw, z: 0.08 },
      { x: -hl, y: hw, z: 0.08 },
      { x: -hl * 0.92, y: -hw * 0.92, z: bodyH },
      { x: hl * 0.5, y: -hw * 0.88, z: bodyH },
      { x: hl * 0.5, y: hw * 0.88, z: bodyH },
      { x: -hl * 0.92, y: hw * 0.92, z: bodyH },
      { x: -hl * 0.5, y: -hw * 0.65, z: roofH },
      { x: hl * 0.1, y: -hw * 0.6, z: roofH },
      { x: hl * 0.1, y: hw * 0.6, z: roofH },
      { x: -hl * 0.5, y: hw * 0.65, z: roofH },
    ];
    const pts = local.map((c) => {
      const wx = car.x + c.x * cos - c.y * sin;
      const wy = car.y + c.x * sin + c.y * cos;
      return project(wx, wy, c.z);
    });

    const face = (idx, fill) => {
      const poly = idx.map((i) => pts[i]);
      if (poly.some((p) => !p)) return null;
      let depth = 0;
      for (const p of poly) depth += p.depth;
      return { poly, fill, depth: depth / poly.length };
    };

    const faces = [
      face([0, 1, 5, 4], d.body),
      face([3, 2, 6, 7], d.body),
      face([1, 2, 6, 5], shadeHex(d.body, 30)),
      face([0, 3, 7, 4], shadeHex(d.body, -35)),
      face([4, 5, 6, 7], shadeHex(d.body, 12)),
      face([8, 9, 10, 11], d.accent || shadeHex(d.body, 40)),
      face([4, 5, 9, 8], shadeHex(d.body, -8)),
      face([7, 6, 10, 11], shadeHex(d.body, -8)),
    ].filter(Boolean);
    faces.sort((a, b) => b.depth - a.depth);
    for (const f of faces) {
      ctx.beginPath();
      ctx.moveTo(f.poly[0].x, f.poly[0].y);
      for (let i = 1; i < f.poly.length; i++) ctx.lineTo(f.poly[i].x, f.poly[i].y);
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Wheels (Hoosier-style)
    const wheels = [
      { x: hl * 0.55, y: -hw * 1.05 },
      { x: hl * 0.55, y: hw * 1.05 },
      { x: -hl * 0.55, y: -hw * 1.05 },
      { x: -hl * 0.55, y: hw * 1.05 },
    ];
    for (const w of wheels) {
      const wx = car.x + w.x * cos - w.y * sin;
      const wy = car.y + w.x * sin + w.y * cos;
      const p = project(wx, wy, 0.35);
      if (!p) continue;
      const r = 0.38 * p.scale;
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 0.55, r, car.angle - (camYaw || 0), 0, TAU);
      ctx.fill();
      // lime beadlock accent for Permann cars
      if (d.trim && (d.number === "37" || d.number === "777")) {
        ctx.strokeStyle = d.trim;
        ctx.lineWidth = Math.max(1, r * 0.15);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * 0.35, r * 0.65, car.angle - (camYaw || 0), 0, TAU);
        ctx.stroke();
      }
    }

    // Real car photo as side billboard (biggest realism win)
    const imgSrc = d.portrait || d.action;
    const img = imgSrc && this.carSprites ? this.carSprites[imgSrc] : null;
    const mid = project(car.x, car.y, 0.95);
    if (img && mid && mid.depth > 2 && mid.depth < 90) {
      // Side plane facing outward from car heading (vertical)
      const side = Math.sin(normAngle(car.angle - (camYaw || 0)));
      const flip = side < 0 ? -1 : 1;
      const w = car.length * mid.scale * 0.95;
      const h = 1.65 * mid.scale;
      ctx.save();
      ctx.translate(mid.x, mid.y - h * 0.15);
      // slight perspective skew with relative yaw
      const skew = clamp(normAngle(car.angle - (camYaw || 0)) * 0.25, -0.45, 0.45);
      ctx.transform(flip, 0, skew, 1, 0, 0);
      ctx.globalAlpha = clamp(1.15 - mid.depth / 100, 0.55, 0.95);
      // Soft mask so photo blends into mesh
      ctx.drawImage(img, -w / 2, -h * 0.75, w, h);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Wing / spoiler
    if (pts[4] && pts[7]) {
      const lift = 12 * (18 / Math.max(pts[4].depth, 8));
      ctx.fillStyle = d.trim || d.accent || "#222";
      ctx.beginPath();
      ctx.moveTo(pts[4].x, pts[4].y - lift);
      ctx.lineTo(pts[7].x, pts[7].y - lift);
      ctx.lineTo(pts[7].x, pts[7].y - lift * 0.35);
      ctx.lineTo(pts[4].x, pts[4].y - lift * 0.35);
      ctx.closePath();
      ctx.fill();
    }

    // Door number (always readable)
    if (mid && mid.depth < 70) {
      const fs = Math.max(11, Math.min(52, 48 * (15 / mid.depth)));
      ctx.save();
      ctx.font = `bold ${fs | 0}px Bebas Neue, Impact, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, fs * 0.1);
      ctx.strokeStyle = "#000";
      ctx.fillStyle = d.stripe || "#fff";
      ctx.strokeText(String(d.number), mid.x, mid.y - mid.scale * 0.3);
      ctx.fillText(String(d.number), mid.x, mid.y - mid.scale * 0.3);
      ctx.restore();
    }
  }

  _drawCockpit(ctx, W, H, cam) {
    // Dusty windshield film
    ctx.fillStyle = "rgba(180,150,100,0.04)";
    ctx.fillRect(W * 0.12, H * 0.1, W * 0.76, H * 0.55);

    // A-pillars / roll cage (chrome-dark tube)
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = 16;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(W * 0.02, H * 0.12);
    ctx.lineTo(W * 0.17, H * 0.52);
    ctx.lineTo(W * 0.1, H * 0.98);
    ctx.moveTo(W * 0.98, H * 0.12);
    ctx.lineTo(W * 0.83, H * 0.52);
    ctx.lineTo(W * 0.9, H * 0.98);
    ctx.stroke();
    ctx.strokeStyle = "rgba(80,80,80,0.5)";
    ctx.lineWidth = 4;
    ctx.stroke();

    // Halo / top bars
    ctx.strokeStyle = "#151515";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H * 0.07);
    ctx.lineTo(W * 0.92, H * 0.07);
    ctx.moveTo(W * 0.2, H * 0.07);
    ctx.lineTo(W * 0.28, H * 0.45);
    ctx.moveTo(W * 0.8, H * 0.07);
    ctx.lineTo(W * 0.72, H * 0.45);
    ctx.stroke();

    // Window net (right side, like a late model)
    ctx.strokeStyle = "rgba(25,25,25,0.4)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const x = W * 0.72 + i * 7;
      ctx.beginPath();
      ctx.moveTo(x, H * 0.14);
      ctx.lineTo(x - 28, H * 0.5);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const y = H * 0.16 + i * 28;
      ctx.beginPath();
      ctx.moveTo(W * 0.7, y);
      ctx.lineTo(W * 0.92, y + 10);
      ctx.stroke();
    }

    // Dash
    ctx.fillStyle = "#14100c";
    ctx.beginPath();
    ctx.moveTo(0, H * 0.7);
    ctx.quadraticCurveTo(W / 2, H * 0.6, W, H * 0.7);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // Hood / cowl — #37 black / orange / green
    const hood = ctx.createLinearGradient(0, H * 0.68, 0, H);
    hood.addColorStop(0, "#2c2c2c");
    hood.addColorStop(0.35, "#1a1a1a");
    hood.addColorStop(1, "#0a0a0a");
    ctx.fillStyle = hood;
    ctx.beginPath();
    ctx.moveTo(W * 0.14, H * 0.76);
    ctx.lineTo(W * 0.86, H * 0.76);
    ctx.lineTo(W * 0.96, H);
    ctx.lineTo(W * 0.04, H);
    ctx.closePath();
    ctx.fill();

    // Flame / accent strip on cowl
    ctx.fillStyle = "#e85d04";
    ctx.fillRect(W * 0.32, H * 0.785, W * 0.36, 7);
    ctx.fillStyle = "#3d9e3a";
    ctx.fillRect(W * 0.32, H * 0.798, W * 0.36, 3);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(W * 0.2, H * 0.82, W * 0.6, 2);

    // Steering wheel
    const wx = W / 2;
    const wy = H * 0.88;
    const steer = cam.steer || 0;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(steer * 0.45);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "#e85d04";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-40, 0);
    ctx.lineTo(40, 0);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 35);
    ctx.stroke();
    // center pad 37
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#3d9e3a";
    ctx.font = "bold 11px Bebas Neue, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("37", 0, 1);
    ctx.restore();

    // Mirror glance dim
    if (this.lookBack) {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(240,180,41,0.8)";
      ctx.font = "20px Bebas Neue, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("LOOKING BACK", W / 2, H * 0.2);
    }
  }
}

export { formatTime };
