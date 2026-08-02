/** Procedural race SFX via Web Audio API (no asset files required) */

export class RaceAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.skidGain = null;
    this.skidSource = null;
    this.crowdGain = null;
    this.crowdSource = null;
    this.rpm = 0;
    this.enabled = false;
    this._skidLevel = 0;
  }

  async resume() {
    if (!this.ctx) this._init();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.enabled = true;
    this._startEngine();
    this._startCrowd();
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);
  }

  _noiseBuffer(seconds = 1) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startEngine() {
    if (this.engine) return;
    const ctx = this.ctx;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0001;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 0.8;

    // Layered oscillators for a rough V8-ish growl
    this.engine = [];
    const specs = [
      { type: "sawtooth", detune: 0, gain: 0.22 },
      { type: "sawtooth", detune: 7, gain: 0.12 },
      { type: "square", detune: -12, gain: 0.06 },
    ];
    for (const s of specs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = s.type;
      o.frequency.value = 55;
      o.detune.value = s.detune;
      g.gain.value = s.gain;
      o.connect(g);
      g.connect(this.engineFilter);
      o.start();
      this.engine.push({ o, g });
    }

    // Exhaust noise
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(2);
    noise.loop = true;
    const ng = ctx.createGain();
    ng.gain.value = 0.04;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 400;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(this.engineFilter);
    noise.start();
    this.engineNoise = { noise, ng, nf };

    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
  }

  _startCrowd() {
    if (this.crowdSource) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(3);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    filter.Q.value = 0.4;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.015;
    src.connect(filter);
    filter.connect(this.crowdGain);
    this.crowdGain.connect(this.master);
    src.start();
    this.crowdSource = src;
  }

  /** speed 0-1, throttle 0-1, slip 0-1, onTrack bool */
  update(speed01, throttle, slip, onTrack) {
    if (!this.enabled || !this.ctx || !this.engineGain) return;
    const t = this.ctx.currentTime;
    const rpm = 0.15 + speed01 * 0.75 + throttle * 0.2;
    this.rpm = rpm;
    const baseFreq = 48 + rpm * 140;
    for (const e of this.engine) {
      e.o.frequency.setTargetAtTime(baseFreq, t, 0.05);
    }
    if (this.engineNoise) {
      this.engineNoise.nf.frequency.setTargetAtTime(280 + rpm * 500, t, 0.08);
      this.engineNoise.ng.gain.setTargetAtTime(0.03 + throttle * 0.05, t, 0.05);
    }
    this.engineFilter.frequency.setTargetAtTime(600 + rpm * 1400, t, 0.08);
    const vol = 0.04 + speed01 * 0.12 + throttle * 0.1;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.05);

    // Skid / tire scrub on dirt
    const wantSkid = slip * (0.4 + speed01) * (onTrack ? 1 : 0.5);
    this._skidLevel += (wantSkid - this._skidLevel) * 0.15;
    this._ensureSkid();
    if (this.skidGain) {
      this.skidGain.gain.setTargetAtTime(this._skidLevel * 0.12, t, 0.04);
    }

    if (this.crowdGain) {
      this.crowdGain.gain.setTargetAtTime(0.012 + speed01 * 0.01, t, 0.2);
    }
  }

  _ensureSkid() {
    if (this.skidSource || !this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1200;
    f.Q.value = 0.7;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    src.connect(f);
    f.connect(this.skidGain);
    this.skidGain.connect(this.master);
    src.start();
    this.skidSource = src;
  }

  impact(strength = 0.5) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(120 + strength * 80, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * strength, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.22);

    // thud noise
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer(0.2);
    const ng = ctx.createGain();
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 300;
    ng.gain.setValueAtTime(0.15 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(this.master);
    n.start(t);
    n.stop(t + 0.2);
  }

  beep(kind = "count") {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    if (kind === "go") {
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.start(t);
      o.stop(t + 0.4);
    } else {
      o.frequency.value = 440;
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.start(t);
      o.stop(t + 0.15);
    }
    o.connect(g);
    g.connect(this.master);
  }

  cheer() {
    if (!this.enabled || !this.ctx || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setValueAtTime(this.crowdGain.gain.value, t);
    this.crowdGain.gain.linearRampToValueAtTime(0.1, t + 0.15);
    this.crowdGain.gain.linearRampToValueAtTime(0.045, t + 1.2);
    this.crowdGain.gain.linearRampToValueAtTime(0.018, t + 3.2);

    // Extra yell bursts (layered noise whoops)
    for (let i = 0; i < 4; i++) {
      const n = this.ctx.createBufferSource();
      n.buffer = this._noiseBuffer(0.35);
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 600 + Math.random() * 900;
      f.Q.value = 0.6;
      const g = this.ctx.createGain();
      const start = t + i * 0.12;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.06 + Math.random() * 0.04, start + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      n.connect(f);
      f.connect(g);
      g.connect(this.master);
      n.start(start);
      n.stop(start + 0.4);
    }
  }

  /**
   * Crowd swell + spoken chant: "Go CJ!" / "Go Dylan!" etc.
   * Uses Web Speech API (works on phone browsers over https).
   */
  chant(who) {
    if (!this.enabled) return;
    this.cheer();

    const name = who === "Dylan" || who === "dylan" ? "Dylan" : "CJ";
    const lines = [
      `Go ${name}!`,
      `Let's go ${name}!`,
      `${name}! ${name}!`,
      `Go ${name} go!`,
      `Come on ${name}!`,
    ];
    const text = lines[(Math.random() * lines.length) | 0];

    try {
      if (!("speechSynthesis" in window)) return;
      // Don't stomp mid-cheer every time — cancel only if queued backlog
      if (speechSynthesis.pending) speechSynthesis.cancel();

      const u = new SpeechSynthesisUtterance(text);
      u.volume = 0.9;
      u.rate = 1.05 + Math.random() * 0.15;
      u.pitch = 0.95 + Math.random() * 0.35;
      u.lang = "en-US";

      // Prefer a punchier English voice when available
      const voices = speechSynthesis.getVoices?.() || [];
      const pick =
        voices.find((v) => /en(-|_)US/i.test(v.lang) && /male|david|mark|google/i.test(v.name)) ||
        voices.find((v) => /en/i.test(v.lang)) ||
        null;
      if (pick) u.voice = pick;

      speechSynthesis.speak(u);
    } catch (err) {
      console.warn("Chant speech failed:", err);
    }
  }

  /** Random Go CJ / Go Dylan */
  randomChant() {
    const who = Math.random() < 0.55 ? "CJ" : "Dylan";
    this.chant(who);
    return who;
  }

  stopAll() {
    if (!this.ctx) return;
    try {
      if (this.engineGain) this.engineGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.1);
      if (this.skidGain) this.skidGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.1);
    } catch (_) {}
    try {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    } catch (_) {}
    this.enabled = false;
  }
}
