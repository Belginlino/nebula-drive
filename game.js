/* ═══════════════════════════════════════════════════════════════════════
   NEBULA DRIVE · build 2.1
   A neon arcade roadster flight simulator. Runs fully offline.

   New in 2.1
     · jump / slide runner mechanics (keyboard + touch + swipes)
     · Subway-Surfers style coins, overhead barriers and cube hazards
     · full mobile support: swipe steering, large touch targets, safe areas,
       portrait + landscape HUD layouts, fullscreen, reduced render cost
     · fixed jump/slide NaN state, duplicate key handling and toast clearing
     · straight Subway-Surfers-style highway track (curves removed)

   Fixed vs 1.0
     · swept obstacle collision (no tunnelling at rocket speed)
     · HUD / rocket state fully reset between runs
     · pooled obstacles + shared geometry/materials (no GPU leak)
     · explicit paint materials (no heuristic recolouring)
     · rocket + pause available on touch
     · result copy per mode, correct next/retry logic
     · three.js vendored locally, clear failure state

   New
     · straight multi-lane highway (Subway-Surfers style)
     · instanced road and city (≈12 draw calls instead of ~500)
     · campaign difficulty curve, unlocks, personal bests, score + streaks
     · WebAudio engine and effects, speed streaks, camera juice
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const THREE = window.THREE;
  const bootEl = $('boot');
  const bootText = $('bootText');
  let failed = false;

  function fatal(message) {
    failed = true;
    bootEl.hidden = false;
    bootEl.classList.remove('done');
    bootText.textContent = message;
    bootText.classList.add('error');
  }

  if (!THREE) {
    fatal('3D ENGINE OFFLINE — vendor/three.min.js could not be loaded.');
    return;
  }

  /* ── helpers ─────────────────────────────────────────────── */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pad2 = (n) => String(n).padStart(2, '0');
  const pad3 = (n) => String(n).padStart(3, '0');
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const MOBILE = !!(window.matchMedia && window.matchMedia('(hover:none) and (pointer:coarse)').matches);
  const isPortrait = () => window.innerHeight > window.innerWidth * 1.05;
  const baseFov = () => (isPortrait() ? 80 : 66);

  /* ── persistent save ─────────────────────────────────────── */
  const SAVE_KEY = 'nebula-drive-v2';
  function defaultSave() {
    return {
      levels: {},
      endless: { score: 0, distance: 0, gates: 0 },
      custom: { score: 0, distance: 0, gates: 0 },
      allUnlocked: false,
      settings: { sound: true, assist: true, paint: '#1d9fff', glow: '#52f6ff', layout: 'flow', length: 5, traffic: 45 }
    };
  }
  let save = loadSave();
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      const data = JSON.parse(raw);
      const base = defaultSave();
      return Object.assign(base, data, {
        levels: data.levels || {},
        endless: Object.assign(base.endless, data.endless),
        custom: Object.assign(base.custom, data.custom),
        settings: Object.assign(base.settings, data.settings)
      });
    } catch (err) {
      return defaultSave();
    }
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (err) { /* private mode */ }
  }

  /* ── audio (WebAudio, no assets) ─────────────────────────── */
  const Sound = {
    ctx: null,
    master: null,
    noise: null,
    engine: null,
    ready: false,
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = save.settings.sound ? 0.5 : 0;
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(2);
        this.ready = true;
      } catch (err) {
        this.ready = false;
      }
    },
    makeNoise(seconds) {
      const ctx = this.ctx;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return buffer;
    },
    setMuted(muted) {
      if (!this.ready) return;
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    },
    startEngine() {
      this.init();
      if (!this.ready) return;
      const ctx = this.ctx;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      if (this.engine) {
        this.engine.gain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.2);
        return;
      }
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 2.5;
      filter.connect(gain);
      gain.connect(this.master);

      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 70;
      o1.connect(filter);

      const o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 35;
      o2.detune.value = -9;
      const g2 = ctx.createGain();
      g2.gain.value = 0.28;
      o2.connect(g2);
      g2.connect(filter);

      const windSrc = ctx.createBufferSource();
      windSrc.buffer = this.noise;
      windSrc.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 800;
      windFilter.Q.value = 0.7;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.0001;
      windSrc.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(this.master);

      o1.start();
      o2.start();
      windSrc.start();
      gain.gain.setTargetAtTime(0.03, ctx.currentTime, 0.4);
      this.engine = { gain, filter, o1, o2, windGain, windFilter };
    },
    engineActive(active) {
      if (!this.ready || !this.engine) return;
      const t = this.ctx.currentTime;
      this.engine.gain.gain.setTargetAtTime(active ? 0.035 : 0.0001, t, 0.12);
      this.engine.windGain.gain.setTargetAtTime(active ? 0.012 : 0.0001, t, 0.15);
    },
    updateEngine(kmh, boosting, rocket) {
      if (!this.ready || !this.engine) return;
      const t = this.ctx.currentTime;
      const n = clamp(kmh / 330, 0, 1);
      const f = 46 + n * 118;
      this.engine.o1.frequency.setTargetAtTime(f, t, 0.12);
      this.engine.o2.frequency.setTargetAtTime(f * 0.5, t, 0.12);
      this.engine.filter.frequency.setTargetAtTime(420 + n * 2100 + (boosting ? 350 : 0), t, 0.14);
      this.engine.gain.gain.setTargetAtTime(0.028 + n * 0.042 + (boosting ? 0.018 : 0), t, 0.15);
      this.engine.windGain.gain.setTargetAtTime(0.008 + n * 0.035 + (rocket ? 0.02 : 0), t, 0.2);
      this.engine.windFilter.frequency.setTargetAtTime(650 + n * 1500, t, 0.2);
    },
    tone(freq, dur, type, vol, delay, slideTo) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol || 0.12), t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    },
    noiseHit(dur, vol, f0, f1) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(f0, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.02);
    },
    ui() { this.tone(920, 0.05, 'square', 0.022); },
    coin() { this.tone(1180, 0.06, 'triangle', 0.045); this.tone(1560, 0.09, 'triangle', 0.04, 0.045); },
    jump() { this.tone(300, 0.16, 'triangle', 0.055, 0, 620); },
    slide() { this.noiseHit(0.22, 0.1, 900, 180); },
    gate(streak) { this.tone(720 + Math.min(streak, 5) * 55, 0.1, 'sine', 0.07); this.tone(1080 + Math.min(streak, 5) * 70, 0.16, 'sine', 0.06, 0.06); },
    impact() { this.noiseHit(0.34, 0.28, 1100, 90); this.tone(110, 0.38, 'sine', 0.17, 0, 42); },
    transform() { this.tone(90, 0.9, 'sawtooth', 0.1, 0, 430); this.noiseHit(0.8, 0.1, 320, 2600); },
    finish(clear) {
      if (!this.ready) return;
      if (clear) {
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.09, i * 0.11));
      } else {
        [392, 311, 233].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.09, i * 0.14));
      }
    }
  };

  /* ── layouts + campaign ──────────────────────────────────── */
  const LAYOUTS = { flow: { name: 'Highway', desc: 'Straight multi-lane highway', width: 17, walls: true } };
  const LAYOUT_KEYS = ['flow'];

  const LEVELS = [
    { name: 'First Light', layout: 'flow', km: 0.8, hazard: 0.34, speed: 0.94 },
    { name: 'Neon Canyon', layout: 'flow', km: 1.0, hazard: 0.4, speed: 0.96 },
    { name: 'Cloud Runner', layout: 'flow', km: 1.2, hazard: 0.42, speed: 0.98 },
    { name: 'Ion Storm', layout: 'flow', km: 1.4, hazard: 0.48, speed: 1.0 },
    { name: 'Glass Horizon', layout: 'flow', km: 1.6, hazard: 0.45, speed: 1.01 },
    { name: 'Pulse Highway', layout: 'flow', km: 1.8, hazard: 0.5, speed: 1.02 },
    { name: 'Skyline Drift', layout: 'flow', km: 2.0, hazard: 0.5, speed: 1.03 },
    { name: 'Solar Gate', layout: 'flow', km: 2.2, hazard: 0.46, speed: 1.04 },
    { name: 'Zero Gravity', layout: 'flow', km: 2.4, hazard: 0.55, speed: 1.05 },
    { name: 'Thunder Loop', layout: 'flow', km: 2.6, hazard: 0.55, speed: 1.06 },
    { name: 'Crystal Pass', layout: 'flow', km: 2.8, hazard: 0.52, speed: 1.07 },
    { name: 'Afterburn', layout: 'flow', km: 3.0, hazard: 0.5, speed: 1.08 },
    { name: 'Phantom Grid', layout: 'flow', km: 3.2, hazard: 0.58, speed: 1.09 },
    { name: 'Aurora Rush', layout: 'flow', km: 3.4, hazard: 0.55, speed: 1.1 },
    { name: 'Redline', layout: 'flow', km: 3.6, hazard: 0.6, speed: 1.12 },
    { name: 'Starfall', layout: 'flow', km: 3.8, hazard: 0.55, speed: 1.13 },
    { name: 'Dark Matter', layout: 'flow', km: 4.0, hazard: 0.62, speed: 1.15 },
    { name: 'Hyperion', layout: 'flow', km: 4.2, hazard: 0.58, speed: 1.16 },
    { name: 'Event Horizon', layout: 'flow', km: 4.4, hazard: 0.6, speed: 1.18 },
    { name: 'Final Ignition', layout: 'flow', km: 4.6, hazard: 0.65, speed: 1.2 }
  ];

  /* ── world constants + state ─────────────────────────────── */
  const CAR_Z = 4;
  const SEG_LEN = 14;
  const SEG_COUNT = 70;
  const RECYCLE_Z = 46;
  const UNLOCK_KM = 0.5;
  const OBS_COUNT = 22;
  const CITY_N = MOBILE ? 64 : 96;

  let state = 'menu';
  let mode = 'endless';
  let selectedLevel = 0;
  let run = null;
  let activeCfg = LAYOUTS.flow;
  let roadWidth = 17;
  let roadGlow = save.settings.glow;
  let paintColor = save.settings.paint;
  let segments = [];
  let trackN = 0;
  let menuTime = 0;
  let lastTime = 0;
  let nextAction = 'retry';
  let devFreeze = false;

  /* three.js handles */
  let scene, camera, renderer;
  let car;
  let paintMat, trimMat, glassMat;
  let slabIM, edgeIM, railIM, railGlowIM, dashIM, wallIM, wallGlowIM, roofIM, roofLightIM;
  let lampIM, lampHeadIM;
  let edgeMat, dashMat, wallGlowMat, railGlowMat, lampHeadMat;
  let gridMesh, gridTex, planetRing;
  let buildingIM, crownIM, city = [];
  let stars, skyMesh, sunSprite, starTex;
  let streakPoints, streakMat, streakPos;
  let obstacles = [];
  let dummy, tmpColor;

  const GEO = {};
  const MAT = {};

  /* ── DOM cache ──────────────────────────────────────────── */
  const ui = {
    hud: $('hud'),
    menu: $('menu'),
    pause: $('pauseScreen'),
    result: $('resultScreen'),
    flash: $('flash'),
    toast: $('toast'),
    modePill: $('modePill'),
    speed: $('speed'),
    distance: $('distance'),
    score: $('score'),
    coinCount: $('coinCount'),
    actionChip: $('actionChip'),
    rocketState: $('rocketState'),
    rocketProgress: $('rocketProgress'),
    integrity: $('integrity'),
    integrityFill: $('integrityFill'),
    gateCount: $('gateCount'),
    streak: $('streak'),
    nitroPct: $('nitroPct'),
    nitroFill: $('nitroFill'),
    bestLine: $('bestLine'),
    levelSelect: $('levelSelect'),
    levelInfo: $('levelInfo'),
    levelControls: $('levelControls'),
    customControls: $('customControls'),
    protocolCount: $('protocolCount'),
    layout: $('layout'),
    layoutDesc: $('layoutDesc'),
    length: $('length'),
    lengthVal: $('lengthVal'),
    traffic: $('traffic'),
    trafficVal: $('trafficVal'),
    carColor: $('carColor'),
    roadColor: $('roadColor'),
    assist: $('assist'),
    heroBest: $('heroBest'),
    footerStats: $('footerStats'),
    campaignSub: $('campaignSub'),
    unlockAll: $('unlockAllBtn'),
    pauseStats: $('pauseStats'),
    resultEyebrow: $('resultEyebrow'),
    resultTitle: $('resultTitle'),
    resultText: $('resultText'),
    resultStats: $('resultStats'),
    resultBadge: $('resultBadge'),
    resultScore: $('resultScore'),
    resultBest: $('resultBest'),
    nextBtn: $('nextBtn')
  };

  /* ── texture helpers ────────────────────────────────────── */
  function radialTexture(inner, mid, size) {
    size = size || 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.42, mid);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function skyTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#010207');
    g.addColorStop(0.38, '#060d1f');
    g.addColorStop(0.68, '#0a1731');
    g.addColorStop(1, '#050812');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);

    const blob = (cx, cy, r, color) => {
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, color);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(210, 210, 330, 'rgba(88,58,220,0.20)');
    blob(700, 250, 300, 'rgba(0,210,255,0.13)');
    blob(500, 120, 220, 'rgba(255,54,196,0.09)');
    blob(880, 160, 180, 'rgba(60,120,255,0.12)');

    for (let i = 0; i < 320; i++) {
      const a = 0.12 + Math.random() * 0.44;
      const r = Math.random() < 0.1 ? 1.1 : 0.55;
      ctx.fillStyle = 'rgba(200,235,255,' + a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(Math.random() * 1024, Math.random() * 340, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* ── instancing helper ──────────────────────────────────── */
  function inst(im, index, x, y, z, ry, sx, sy, sz) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, ry || 0, 0);
    dummy.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    dummy.updateMatrix();
    im.setMatrixAt(index, dummy.matrix);
  }

  function makeIM(geometry, material, count) {
    const im = new THREE.InstancedMesh(geometry, material, count);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.matrixAutoUpdate = false;
    scene.add(im);
    return im;
  }

  /* ── scene setup ────────────────────────────────────────── */
  function init3D() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050812);
    scene.fog = new THREE.FogExp2(0x070c1c, 0.0022);

    camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 2600);
    camera.position.set(0, 6.4, 15.5);

    renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    $('game').appendChild(renderer.domElement);

    dummy = new THREE.Object3D();
    tmpColor = new THREE.Color();

    createLights();
    createSky();
    createStars();
    createGrid();
    createRoad();
    buildTrack();
    createCity();
    createCar();
    createObstacles();
    createStreaks();

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 260));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  }

  function createLights() {
    scene.add(new THREE.HemisphereLight(0x9ccaff, 0x12162b, 2.4));
    const key = new THREE.DirectionalLight(0xb4e5ff, 3.4);
    key.position.set(-8, 15, 9);
    scene.add(key);
    const pink = new THREE.PointLight(0x5d50ff, 32, 130);
    pink.position.set(22, 6, -46);
    scene.add(pink);
    const cyan = new THREE.PointLight(0x35eaff, 26, 130);
    cyan.position.set(-22, 4, -95);
    scene.add(cyan);
  }

  function createSky() {
    skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 20),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
    );
    scene.add(skyMesh);

    sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture('rgba(255,236,200,0.95)', 'rgba(255,90,210,0.35)', 256),
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    }));
    sunSprite.position.set(470, 250, -1420);
    sunSprite.scale.set(400, 400, 1);
    scene.add(sunSprite);

    /* a thin orbital ring around the distant planet */
    planetRing = new THREE.Mesh(
      new THREE.RingGeometry(215, 300, 96, 1),
      new THREE.MeshBasicMaterial({
        color: 0x8e6dff,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
      })
    );
    planetRing.position.copy(sunSprite.position);
    planetRing.position.z -= 6;
    planetRing.rotation.set(-1.12, 0.18, 0.3);
    scene.add(planetRing);
  }

  function createStars() {
    starTex = radialTexture('rgba(255,255,255,1)', 'rgba(190,226,255,0.55)', 64);
    const starCount = MOBILE ? 900 : 1600;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = rand(-950, 950);
      positions[i * 3 + 1] = rand(-20, 340);
      positions[i * 3 + 2] = rand(-1400, -520);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xbfe4ff,
      map: starTex,
      alphaTest: 0.03,
      size: 5.2,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    }));
    scene.add(stars);
  }

  /* ── city (instanced towers with baked window lights) ────── */
  const CITY_PALETTE = [0x0e1b34, 0x121c36, 0x16254a, 0x0c1a30, 0x1a2145];
  const CROWN_PALETTE = [0x4af5ff, 0xa45cff, 0x7fb8ff, 0xff5fd0, 0x5dffc4];
  const CITY_BASE = -22;
  const CITY_SPAN = 2600;

  function towerTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#03060d';
    ctx.fillRect(0, 0, 128, 256);
    const rows = 22;
    const ch = 256 / rows;
    const colors = ['#63f8ff', '#7fb8ff', '#5fa8ff', '#a45cff', '#ff5fd0', '#d9f6ff'];
    for (let r = 0; r < rows; r++) {
      const lit = Math.random();
      if (lit < 0.3) continue;
      ctx.globalAlpha = 0.12 + lit * 0.55;
      ctx.fillStyle = colors[(r * 5 + Math.floor(lit * 11)) % colors.length];
      ctx.fillRect(4, r * ch + 1, 120, Math.random() < 0.24 ? 3.4 : 1.6);
      if (lit > 0.82) {
        ctx.globalAlpha = 0.1 + lit * 0.25;
        ctx.fillRect(4, r * ch + 4.2, 120, 1);
      }
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function createCity() {
    const structureGeo = new THREE.BoxGeometry(1, 1, 1);
    const structureMat = new THREE.MeshStandardMaterial({
      color: 0x18243f,
      metalness: 0.45,
      roughness: 0.62,
      emissive: 0xffffff,
      emissiveMap: towerTexture(),
      emissiveIntensity: 0.9
    });
    buildingIM = makeIM(structureGeo, structureMat, CITY_N);

    crownIM = makeIM(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      CITY_N
    );

    for (let i = 0; i < CITY_N; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const h = rand(18, 92);
      city.push({
        side,
        dist: 26 + Math.pow(Math.random(), 0.8) * 86,
        z: -20 - Math.random() * CITY_SPAN,
        w: rand(7, 16),
        h,
        d: rand(9, 22),
        crown: Math.random() < 0.75
      });
      buildingIM.setColorAt(i, tmpColor.setHex(CITY_PALETTE[i % CITY_PALETTE.length]));
      crownIM.setColorAt(i, tmpColor.setHex(CROWN_PALETTE[i % CROWN_PALETTE.length]));
    }
    if (buildingIM.instanceColor) buildingIM.instanceColor.needsUpdate = true;
    if (crownIM.instanceColor) crownIM.instanceColor.needsUpdate = true;
    updateCity(0);
  }

  function updateCity(move) {
    for (let i = 0; i < CITY_N; i++) {
      const b = city[i];
      b.z += move * 0.55;
      if (b.z > 55) b.z -= CITY_SPAN;
      const track = trackAt(b.z);
      const x = track.x + b.side * b.dist;
      inst(buildingIM, i, x, CITY_BASE + b.h / 2, b.z, 0, b.w, b.h, b.d);
      inst(
        crownIM, i,
        x - b.side * (b.w / 2 + 0.07),
        CITY_BASE + b.h - 1.1,
        b.z, 0,
        0.14, b.crown ? 1.1 : 0.0001, b.d * 0.9
      );
    }
    buildingIM.instanceMatrix.needsUpdate = true;
    crownIM.instanceMatrix.needsUpdate = true;
  }

  /* ── ground grid far below the road ──────────────────────── */
  function gridTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(4,10,22,0.55)';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(82,246,255,0.5)';
    ctx.lineWidth = 2;
    for (let g = 0; g <= 256; g += 64) {
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(256, g); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(162,92,255,0.35)';
    ctx.lineWidth = 1;
    for (let g = 32; g < 256; g += 64) {
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(256, g); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(34, 34);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function createGrid() {
    gridTex = gridTexture();
    gridMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4200, 4200),
      new THREE.MeshBasicMaterial({
        map: gridTex,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
        toneMapped: false
      })
    );
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.set(0, -24, -600);
    scene.add(gridMesh);
  }

  /* ── road ───────────────────────────────────────────────── */
  function createRoad() {
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x1a2740,
      metalness: 0.55,
      roughness: 0.4,
      emissive: 0x0a1628,
      emissiveIntensity: 0.75
    });
    edgeMat = new THREE.MeshBasicMaterial({ color: 0x52f6ff, toneMapped: false });
    dashMat = new THREE.MeshBasicMaterial({ color: 0xd8fbff, toneMapped: false });
    wallGlowMat = new THREE.MeshBasicMaterial({ color: 0x52f6ff, toneMapped: false });
    railGlowMat = new THREE.MeshBasicMaterial({ color: 0x52f6ff, toneMapped: false });
    lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xdaf7ff, toneMapped: false });

    slabIM = makeIM(new THREE.BoxGeometry(1, 0.7, SEG_LEN + 0.8), roadMat, SEG_COUNT);
    edgeIM = makeIM(new THREE.BoxGeometry(0.18, 0.1, SEG_LEN + 0.8), edgeMat, SEG_COUNT * 2);
    railIM = makeIM(
      new THREE.BoxGeometry(0.16, 0.72, SEG_LEN + 0.8),
      new THREE.MeshStandardMaterial({ color: 0x1a2b4d, metalness: 0.9, roughness: 0.28, emissive: 0x0a2a45, emissiveIntensity: 0.9 }),
      SEG_COUNT * 2
    );
    railGlowIM = makeIM(new THREE.BoxGeometry(0.1, 0.07, SEG_LEN + 0.8), railGlowMat, SEG_COUNT * 2);
    dashIM = makeIM(new THREE.BoxGeometry(0.13, 0.04, 2.8), dashMat, SEG_COUNT * 6);

    lampIM = makeIM(
      new THREE.BoxGeometry(0.15, 3.5, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x1d3355, metalness: 0.85, roughness: 0.35, emissive: 0x0b2440, emissiveIntensity: 0.7 }),
      SEG_COUNT * 2
    );
    lampHeadIM = makeIM(new THREE.BoxGeometry(0.7, 0.1, 0.4), lampHeadMat, SEG_COUNT * 2);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0c1526, metalness: 0.6, roughness: 0.5, emissive: 0x08182c, emissiveIntensity: 0.7 });
    wallIM = makeIM(new THREE.BoxGeometry(0.4, 8.4, SEG_LEN + 0.8), wallMat, SEG_COUNT * 2);
    wallGlowIM = makeIM(new THREE.BoxGeometry(0.09, 0.13, SEG_LEN + 0.8), wallGlowMat, SEG_COUNT * 6);
    roofIM = makeIM(new THREE.BoxGeometry(1, 0.42, SEG_LEN + 0.8), wallMat, SEG_COUNT);
    roofLightIM = makeIM(new THREE.BoxGeometry(1, 0.09, 4.6), lampHeadMat, SEG_COUNT);
  }

  function buildTrack() {
    segments = [];
    trackN = 0;
    for (let i = 0; i < SEG_COUNT; i++) {
      segments.push({ x: 0, z: SEG_LEN * 3 - i * SEG_LEN, heading: 0 });
    }
    updateRoadInstances();
  }

  function extendTrack(seg) {
    const last = segments[segments.length - 1];
    const n = trackN++;
    // straight line: x stays 0, z just decrements
    seg.heading = 0;
    seg.x = 0;
    seg.z = last.z - SEG_LEN;
  }

  function trackAt(z) {
    return { x: 0, heading: 0 };
  }

  function moveWorld(move) {
    for (let i = 0; i < segments.length; i++) segments[i].z += move;
    while (segments.length && segments[0].z > RECYCLE_Z) {
      const seg = segments.shift();
      extendTrack(seg);
      segments.push(seg);
    }
    updateRoadInstances();
    updateCity(move);
    if (gridTex) gridTex.offset.y -= move / 124;
  }

  function updateRoadInstances() {
    const half = roadWidth / 2;
    const walls = !!activeCfg.walls;
    const lampOffset = half + 1.6;
    for (let i = 0; i < SEG_COUNT; i++) {
      const s = segments[i];
      if (!s) continue;
      const h = s.heading;
      const cos = Math.cos(h);
      const sin = Math.sin(h);
      inst(slabIM, i, s.x, -0.65, s.z, h, roadWidth, 1, 1);
      inst(edgeIM, i * 2, s.x + cos * half, -0.25, s.z - sin * half, h, 1, 1, 1);
      inst(edgeIM, i * 2 + 1, s.x - cos * half, -0.25, s.z + sin * half, h, 1, 1, 1);
      inst(railIM, i * 2, s.x + cos * (half + 0.28), 0.03, s.z - sin * (half + 0.28), h, 1, 1, 1);
      inst(railIM, i * 2 + 1, s.x - cos * (half + 0.28), 0.03, s.z + sin * (half + 0.28), h, 1, 1, 1);
      inst(railGlowIM, i * 2, s.x + cos * (half + 0.28), 0.42, s.z - sin * (half + 0.28), h, 1, 1, 1);
      inst(railGlowIM, i * 2 + 1, s.x - cos * (half + 0.28), 0.42, s.z + sin * (half + 0.28), h, 1, 1, 1);

      for (let lane = 0; lane < 2; lane++) {
        const laneX = (lane === 0 ? -1 : 1) * half * 0.5;
        for (let d = 0; d < 3; d++) {
          const off = (d - 1) * SEG_LEN * 0.34;
          inst(
            dashIM, i * 6 + lane * 3 + d,
            s.x + cos * laneX + sin * off,
            -0.27,
            s.z - sin * laneX + cos * off,
            h, 1, 1, 1
          );
        }
      }

      inst(lampIM, i * 2, s.x + cos * lampOffset, 1.75, s.z - sin * lampOffset, h, 1, 1, 1);
      inst(lampIM, i * 2 + 1, s.x - cos * lampOffset, 1.75, s.z + sin * lampOffset, h, 1, 1, 1);
      inst(lampHeadIM, i * 2, s.x + cos * (lampOffset - 0.55), 3.5, s.z - sin * (lampOffset - 0.55), h, 1, 1, 1);
      inst(lampHeadIM, i * 2 + 1, s.x - cos * (lampOffset - 0.55), 3.5, s.z + sin * (lampOffset - 0.55), h, 1, 1, 1);

      if (walls) {
        inst(wallIM, i * 2, s.x + cos * (half + 0.24), 4.2, s.z - sin * (half + 0.24), h, 1, 1, 1);
        inst(wallIM, i * 2 + 1, s.x - cos * (half + 0.24), 4.2, s.z + sin * (half + 0.24), h, 1, 1, 1);
        for (let row = 0; row < 3; row++) {
          const y = 1.5 + row * 3.1;
          inst(wallGlowIM, i * 6 + row * 2, s.x + cos * (half + 0.05), y, s.z - sin * (half + 0.05), h, 1, 1, 1);
          inst(wallGlowIM, i * 6 + row * 2 + 1, s.x - cos * (half + 0.05), y, s.z + sin * (half + 0.05), h, 1, 1, 1);
        }
        inst(roofIM, i, s.x, 8.45, s.z, h, roadWidth, 1, 1);
        inst(roofLightIM, i, s.x, 8.16, s.z, h, roadWidth * 0.34, 1, 1);
      }
    }
    slabIM.instanceMatrix.needsUpdate = true;
    edgeIM.instanceMatrix.needsUpdate = true;
    railIM.instanceMatrix.needsUpdate = true;
    railGlowIM.instanceMatrix.needsUpdate = true;
    dashIM.instanceMatrix.needsUpdate = true;
    lampIM.instanceMatrix.needsUpdate = true;
    lampHeadIM.instanceMatrix.needsUpdate = true;
    if (walls) {
      wallIM.instanceMatrix.needsUpdate = true;
      wallGlowIM.instanceMatrix.needsUpdate = true;
      roofIM.instanceMatrix.needsUpdate = true;
      roofLightIM.instanceMatrix.needsUpdate = true;
    }
    wallIM.visible = walls;
    wallGlowIM.visible = walls;
    roofIM.visible = walls;
    roofLightIM.visible = walls;
    lampIM.visible = !walls;
    lampHeadIM.visible = !walls;
  }

  function applyRoadStyle() {
    edgeMat.color.set(roadGlow);
    wallGlowMat.color.set(roadGlow);
    railGlowMat.color.set(roadGlow);
    dashMat.color.set(roadGlow).lerp(new THREE.Color(0xffffff), 0.45);
    if (paintMat) paintMat.color.set(paintColor);
  }

  /* ── car ────────────────────────────────────────────────── */
  let transformParts = {};

  function createCar() {
    car = new THREE.Group();
    paintMat = new THREE.MeshPhysicalMaterial({
      color: paintColor,
      metalness: 0.82,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      emissive: 0x07203a,
      emissiveIntensity: 0.5
    });
    trimMat = new THREE.MeshStandardMaterial({ color: 0x080d18, metalness: 0.65, roughness: 0.24 });
    glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x091d33,
      metalness: 0.72,
      roughness: 0.08,
      transmission: 0.2,
      transparent: true,
      opacity: 0.94,
      clearcoat: 1
    });
    const headMat = new THREE.MeshBasicMaterial({ color: 0x52f6ff });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3f78 });

    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      car.add(mesh);
      return mesh;
    };

    add(new THREE.BoxGeometry(2.6, 0.52, 4.9), paintMat, 0, 0.45, 0);
    add(new THREE.BoxGeometry(2.72, 0.2, 4.3), trimMat, 0, 0.18, 0);
    add(new THREE.BoxGeometry(2.25, 0.22, 1.6), paintMat, 0, 0.72, -1.3);
    add(new THREE.BoxGeometry(1.7, 0.66, 1.9), glassMat, 0, 0.94, 0.12);
    add(new THREE.BoxGeometry(1.74, 0.14, 1.98), paintMat, 0, 1.31, 0.12);
    add(new THREE.BoxGeometry(1.42, 0.34, 0.08), glassMat, 0, 1.06, 1.08);
    add(new THREE.BoxGeometry(2.5, 0.08, 0.5), trimMat, 0, 0.22, -2.52);
    add(new THREE.BoxGeometry(2.3, 0.1, 0.4), trimMat, 0, 0.26, 2.5);
    add(new THREE.BoxGeometry(2.2, 0.09, 0.45), trimMat, 0, 0.98, 2.1);
    add(new THREE.BoxGeometry(0.12, 0.34, 0.16), trimMat, -0.82, 0.79, 2.14);
    add(new THREE.BoxGeometry(0.12, 0.34, 0.16), trimMat, 0.82, 0.79, 2.14);

    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.3, 24);    const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 16);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b4c74, metalness: 1, roughness: 0.25 });
    for (const x of [-1, 1]) {
      for (const z of [-1.55, 1.55]) {
        const wheel = new THREE.Mesh(wheelGeo, trimMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x * 1.3, 0.26, z);
        car.add(wheel);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.rotation.z = Math.PI / 2;
        rim.position.set(x * 1.44, 0.26, z);
        car.add(rim);
      }
      add(new THREE.BoxGeometry(0.55, 0.12, 0.08), headMat, x * 0.7, 0.56, -2.47);
      add(new THREE.BoxGeometry(0.52, 0.1, 0.08), tailMat, x * 0.72, 0.52, 2.47);
    }
    add(new THREE.BoxGeometry(1.9, 0.08, 0.1), tailMat, 0, 0.62, 2.5);
    add(new THREE.BoxGeometry(0.7, 0.05, 0.06), headMat, 0, 0.66, -2.52);

    /* transformation wings */
    transformParts.wings = [];
    transformParts.canards = [];
    for (const x of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(x * 0.9, 0.78, 0.5);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.11, 0.62), paintMat);
      blade.position.x = x * 0.4;
      blade.rotation.z = x * 0.14;
      wing.add(blade);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.16), trimMat);
      strut.position.set(x * 0.42, -0.28, 0);
      wing.add(strut);
      wing.scale.setScalar(0.22);
      car.add(wing);
      transformParts.wings.push({ group: wing, side: x });

      const canard = new THREE.Group();
      canard.position.set(x * 0.75, 0.56, -1.8);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.09, 0.48), paintMat);
      fin.position.x = x * 0.34;
      fin.rotation.z = -x * 0.1;
      canard.add(fin);
      canard.scale.setScalar(0.35);
      car.add(canard);
      transformParts.canards.push({ group: canard, side: x });

      const thruster = new THREE.Group();
      thruster.position.set(x * 0.68, 0.44, 2.82);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.27, 0.45, 24), trimMat);
      nozzle.rotation.x = Math.PI / 2;
      thruster.add(nozzle);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 1.15, 20),
        new THREE.MeshBasicMaterial({ color: 0x52f6ff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = 0.64;
      thruster.add(flame);
      const glow = new THREE.PointLight(0x52f6ff, 0, 9);
      glow.position.z = 0.7;
      thruster.add(glow);
      car.add(thruster);
      if (x < 0) transformParts.leftThruster = { group: thruster, flame, glow };
      else transformParts.rightThruster = { group: thruster, flame, glow };
    }

    /* fake contact shadow */
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 7.2),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'),
        transparent: true,
        depthWrite: false,
        opacity: 0.85
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.27;
    car.add(shadow);

    const under = new THREE.PointLight(0x20dfff, 7, 11);
    under.position.set(0, -0.1, 0);
    car.add(under);

    const rim = new THREE.PointLight(0x8fe8ff, 16, 20);
    rim.position.set(0, 4.2, -2.5);
    car.add(rim);

    car.position.set(0, 0, CAR_Z);
    scene.add(car);
  }

  function animateCar(dt, deploy) {
    const wingScale = 0.22 + 0.78 * deploy;
    for (const w of transformParts.wings) {
      const targetY = w.side * deploy * 0.55;
      const targetZ = w.side * deploy * 0.1;
      w.group.rotation.y += (targetY - w.group.rotation.y) * Math.min(1, dt * 4);
      w.group.rotation.z += (targetZ - w.group.rotation.z) * Math.min(1, dt * 4);
      w.group.scale.x += (wingScale - w.group.scale.x) * Math.min(1, dt * 5);
      w.group.scale.y += (wingScale - w.group.scale.y) * Math.min(1, dt * 5);
      w.group.scale.z += (wingScale - w.group.scale.z) * Math.min(1, dt * 5);
    }
    for (const c of transformParts.canards) {
      c.group.rotation.z += (c.side * deploy * 0.26 - c.group.rotation.z) * Math.min(1, dt * 5);
      const cs = 0.35 + 0.65 * deploy;
      c.group.scale.x += (cs - c.group.scale.x) * Math.min(1, dt * 5);
      c.group.scale.y += (cs - c.group.scale.y) * Math.min(1, dt * 5);
      c.group.scale.z += (cs - c.group.scale.z) * Math.min(1, dt * 5);
    }
    for (const key of ['leftThruster', 'rightThruster']) {
      const t = transformParts[key];
      if (!t) continue;
      t.flame.scale.y = deploy * (0.75 + Math.random() * 0.55);
      t.flame.material.opacity = deploy ? 0.92 : 0.08;
      t.glow.intensity = deploy ? 18 : 0;
    }
  }

  /* ── obstacles ──────────────────────────────────────────── */
  function createObstacles() {
    GEO.coin = new THREE.CircleGeometry(0.78, 20);
    GEO.cube = new THREE.BoxGeometry(2.2, 2.2, 2.2);
    GEO.gate = new THREE.TorusGeometry(3, 0.18, 10, 40);
    GEO.bar = new THREE.BoxGeometry(6.4, 2.1, 0.85);
    MAT.coin = new THREE.MeshStandardMaterial({
      color: 0xffc93c,
      emissive: 0xffa000,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.22
    });
    MAT.cube = new THREE.MeshStandardMaterial({
      color: 0x7c2eff,
      metalness: 0.6,
      roughness: 0.28,
      emissive: 0x29085f,
      emissiveIntensity: 0.7
    });
    MAT.bar = new THREE.MeshStandardMaterial({
      color: 0xff8a2b,
      metalness: 0.45,
      roughness: 0.32,
      emissive: 0xff4a12,
      emissiveIntensity: 0.75
    });
    MAT.gate = new THREE.MeshBasicMaterial({ color: 0x52f6ff });
    for (let i = 0; i < OBS_COUNT; i++) {
      const mesh = new THREE.Mesh(GEO.cube, MAT.cube);
      mesh.visible = false;
      mesh.matrixAutoUpdate = true;
      scene.add(mesh);
      obstacles.push({ mesh, z: 0, prevZ: 0, lane: 0, type: 'cube', hit: false, spin: 0 });
    }
  }

  function respawnObstacle(o, z) {
    const hazard = run ? run.hazard : 0.42;
    const roll = Math.random();
    let type;
    if (roll < 0.32) type = 'coin';
    else if (roll < 0.52) type = 'bar';
    else if (roll < 0.52 + (1 - hazard) * 0.55) type = 'gate';
    else type = 'cube';

    const half = roadWidth / 2;
    o.type = type;
    o.hit = false;
    o.spin = rand(0, Math.PI * 2);
    o.z = z;
    o.prevZ = z;
    if (type === 'coin') o.lane = rand(-(half - 1.5), half - 1.5);
    else if (type === 'bar') o.lane = rand(-(half - 3.5), half - 3.5);
    else if (type === 'gate') o.lane = rand(-(half - 3.2), half - 3.2);
    else o.lane = rand(-(half - 2.4), half - 2.4);

    o.mesh.geometry = type === 'coin' ? GEO.coin : type === 'gate' ? GEO.gate : type === 'bar' ? GEO.bar : GEO.cube;
    o.mesh.material = type === 'coin' ? MAT.coin : type === 'gate' ? MAT.gate : type === 'bar' ? MAT.bar : MAT.cube;
    o.mesh.scale.setScalar(1);
    o.mesh.visible = true;
    const t = trackAt(z);
    const y = type === 'coin' ? 0.95 : type === 'gate' ? 2.0 : type === 'bar' ? 2.15 : 1.05;
    o.mesh.position.set(t.x + o.lane, y, z);
    o.mesh.rotation.set(0, type === 'coin' ? o.spin : t.heading, type === 'gate' ? o.spin : 0);
  }

  function seedObstacles() {
    let z = -130;
    for (const o of obstacles) {
      respawnObstacle(o, z);
      z -= rand(52, 92);
    }
  }

  function hideObstacles() {
    for (const o of obstacles) o.mesh.visible = false;
  }

  function farthestObstacleZ() {
    let min = 0;
    for (const o of obstacles) if (o.z < min) min = o.z;
    return min;
  }

  /* ── speed streaks ──────────────────────────────────────── */
  function createStreaks() {
    const count = 200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rand(-26, 26);
      positions[i * 3 + 1] = rand(1, 20);
      positions[i * 3 + 2] = rand(-170, 10);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    streakPos = geo.getAttribute('position');
    streakMat = new THREE.PointsMaterial({
      color: 0xcdf7ff,
      size: 0.4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    streakPoints = new THREE.Points(geo, streakMat);
    streakPoints.frustumCulled = false;
    scene.add(streakPoints);
  }

  function updateStreaks(dt, move, carX) {
    const targetOpacity = reduceMotion ? 0 : (run ? clamp((run.speed - 210) / 120, 0, 1) * 0.75 + (run.rocketActive > 0 ? 0.25 : 0) : 0);
    streakMat.opacity = lerp(streakMat.opacity, targetOpacity, Math.min(1, dt * 4));
    if (streakMat.opacity < 0.02) return;
    const arr = streakPos.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] += move * 2.4;
      if (arr[i + 2] > 18) {
        arr[i] = carX + rand(-26, 26);
        arr[i + 1] = rand(1, 20);
        arr[i + 2] = rand(-170, -60);
      }
    }
    streakPos.needsUpdate = true;
  }

  /* ── menu preview ───────────────────────────────────────── */
  function previewWorld() {
    activeCfg = Object.assign({}, previewLayout());
    roadWidth = activeCfg.width;
    roadGlow = ui.roadColor.value;
    paintColor = ui.carColor.value;
    applyRoadStyle();
    buildTrack();
    hideObstacles();
    if (car) {
      car.position.set(0, 0, CAR_Z);
      car.rotation.set(0, 0, 0);
    }
    paintMat.color.set(paintColor);
    animateCar(0.016, 0);
    camera.position.set(0, 6.4, isPortrait() ? 18 : 15.5);
    camera.fov = baseFov();
    camera.updateProjectionMatrix();
  }

  function previewLayout() {
    if (mode === 'levels') return LAYOUTS[LEVELS[selectedLevel].layout] || LAYOUTS.flow;
    if (mode === 'custom') return LAYOUTS[ui.layout.value] || LAYOUTS.flow;
    return LAYOUTS.flow;
  }

  function updateIdle(dt) {
    menuTime += dt;
    moveWorld(14 * dt);
    if (!car) return;
    car.position.y = Math.sin(menuTime * 1.5) * 0.03;
    car.rotation.z = Math.sin(menuTime * 0.7) * 0.012;
    car.rotation.y = 0;
    animateCar(dt, 0);
    camera.position.x = Math.sin(menuTime * 0.24) * 0.8;
    camera.position.y = 6.2 + Math.sin(menuTime * 0.4) * 0.12;
    camera.position.z = isPortrait() ? 18 : 15.5;
    camera.lookAt(0, 1.0, -30);
    if (stars) stars.rotation.y += dt * 0.005;
    if (sunSprite) sunSprite.material.opacity = 0.65 + Math.sin(menuTime * 0.7) * 0.08;
  }

  /* ── run lifecycle ──────────────────────────────────────── */
  function buildRunConfig() {
    if (mode === 'levels') {
      const level = LEVELS[selectedLevel];
      return {
        level: selectedLevel,
        layout: level.layout,
        length: level.km,
        hazard: level.hazard,
        speedMul: level.speed,
        label: 'CAMPAIGN · ' + pad2(selectedLevel + 1) + ' / ' + LEVELS.length
      };
    }
    if (mode === 'custom') {
      const layout = ui.layout.value;
      return {
        level: -1,
        layout,
        length: +ui.length.value,
        hazard: +ui.traffic.value / 100,
        speedMul: 1,
        label: 'CUSTOM · ' + LAYOUTS[layout].name.toUpperCase()
      };
    }
    return { level: -1, layout: 'flow', length: Infinity, hazard: 0.36, speedMul: 1, label: 'ENDLESS PROTOCOL' };
  }

  function startRun() {
    if (failed) return;
    Sound.init();
    const cfg = buildRunConfig();
    paintColor = ui.carColor.value;
    roadGlow = ui.roadColor.value;
    activeCfg = Object.assign({}, LAYOUTS[cfg.layout]);
    roadWidth = activeCfg.width;

    run = {
      mode: mode,
      level: cfg.level,
      layout: cfg.layout,
      length: cfg.length,
      hazard: cfg.hazard,
      speedMul: cfg.speedMul,
      label: cfg.label,
      assist: ui.assist.value === 'on',
      cfg: activeCfg,
      distance: 0,
      speed: 0,
      nitro: 100,
      integrity: 100,
      topSpeed: 0,
      rocketUnlocked: false,
      rocketSpent: false,
      rocketActive: 0,
      steer: 0,
      lane: 0,
      elapsed: 0,
      gates: 0,
      gatePoints: 0,
      coins: 0,
      coinScore: 0,
      streak: 0,
      shake: 0,
      lastAudio: 0,
      invuln: 0,
      isJumping: false,
      jumpT: 0,
      jumpDur: 0.66,
      jumpOffset: 0,
      isSliding: false,
      slideT: 0,
      slideDur: 0.62,
      slideOffset: 0,
      rideY: 0
    };

    applyRoadStyle();
    buildTrack();
    seedObstacles();
    resetCarForRun();

    state = 'running';
    ui.menu.hidden = true;
    ui.pause.hidden = true;
    ui.result.hidden = true;
    ui.hud.hidden = false;
    ui.modePill.textContent = cfg.label;
    ui.bestLine.textContent = bestLabel();

    ui.rocketState.textContent = 'LOCKED · ' + UNLOCK_KM.toFixed(1) + ' KM';
    ui.rocketState.style.color = '#a3b5d6';
    ui.rocketProgress.style.width = '0%';
    ui.integrity.style.color = '#5dffc4';
    ui.gateCount.textContent = '0';
    ui.streak.textContent = '×1';
    ui.streak.classList.remove('hot');
    ui.speed.textContent = '000';
    ui.distance.textContent = '0.00';
    ui.score.textContent = '0';
    if (ui.coinCount) ui.coinCount.textContent = '0';
    if (ui.actionChip) { ui.actionChip.textContent = ''; ui.actionChip.className = 'action-chip'; }
    ui.nitroPct.textContent = '100%';
    ui.nitroFill.style.width = '100%';
    ui.integrity.textContent = '100%';
    ui.integrityFill.style.width = '100%';

    clearInputs();
    Sound.startEngine();
    Sound.engineActive(true);
    showToast('IGNITION SEQUENCE STARTED', 'good', 1800);
    lastTime = performance.now();
  }

  function resetCarForRun() {
    car.position.set(0, 0, CAR_Z);
    car.rotation.set(0, 0, 0);
    car.scale.set(1, 1, 1);
    paintMat.color.set(paintColor);
    for (const w of transformParts.wings) w.group.rotation.set(0, 0, 0);
    for (const c of transformParts.canards) c.group.rotation.set(0, 0, 0);
    for (const key of ['leftThruster', 'rightThruster']) {
      const t = transformParts[key];
      if (!t) continue;
      t.flame.scale.set(1, 0.08, 1);
      t.flame.material.opacity = 0.08;
      t.glow.intensity = 0;
    }
    camera.position.set(0, 6.4, isPortrait() ? 18 : 15.5);
    camera.fov = baseFov();
    camera.updateProjectionMatrix();
  }

  /* ── scoring ────────────────────────────────────────────── */
  function scoreOf(includeIntegrity) {
    if (!run) return 0;
    const base = run.distance * 1000 + run.gatePoints + run.gates * 40 + (run.coinScore || 0);
    return includeIntegrity ? base + run.integrity * 12 : base;
  }

  function bestLabel() {
    if (mode === 'levels') {
      const best = save.levels[selectedLevel];
      return best && best.score ? 'BEST · ' + fmt(best.score) : 'NO RECORD YET';
    }
    if (mode === 'custom') {
      return save.custom.score ? 'BEST · ' + fmt(save.custom.score) : 'NO RECORD YET';
    }
    return save.endless.distance ? 'BEST · ' + save.endless.distance.toFixed(2) + ' KM' : 'NO RECORD YET';
  }

  /* ── core update ────────────────────────────────────────── */
  function update(dt) {
    const R = run;
    R.elapsed += dt;
    R.invuln = Math.max(0, R.invuln - dt);

    /* ── jump / slide ──────────────────────────────── */
    if (R.isJumping) {
      R.jumpT += dt;
      const jt = Math.min(1, R.jumpT / R.jumpDur);
      R.jumpOffset = Math.sin(Math.PI * jt) * 2.6;
      if (jt >= 1) { R.isJumping = false; R.jumpOffset = 0; }
    } else {
      R.jumpOffset = 0;
    }
    if (R.isSliding) {
      R.slideT += dt;
      const st = Math.min(1, R.slideT / R.slideDur);
      R.slideOffset = -Math.sin(Math.PI * st) * 0.62;
      if (st >= 1) { R.isSliding = false; R.slideOffset = 0; }
    } else {
      R.slideOffset = 0;
    }

    if (R.mode === 'endless') {
      R.hazard = Math.min(0.72, 0.34 + R.distance * 0.055);
      R.speedMul = Math.min(1.22, 1 + R.distance * 0.022);
      R.cfg.amp = Math.min(0.26, 0.14 + R.distance * 0.018);
    }

    const boosting = held('nitro') && R.nitro > 0;
    let target = held('accel') ? 155 : 92;
    target *= R.speedMul;
    if (boosting) target = 245 * R.speedMul;
    if (R.rocketActive > 0) target = 325 * R.speedMul;
    if (held('brake')) target = 30;

    R.speed += (target - R.speed) * Math.min(1, dt * (held('accel') || boosting ? 1.8 : 0.9));
    if (!held('accel') && !held('brake') && !boosting && R.rocketActive <= 0) R.speed = Math.max(60, R.speed);
    R.topSpeed = Math.max(R.topSpeed, R.speed);

    if (boosting) R.nitro = Math.max(0, R.nitro - 27 * dt);
    else R.nitro = Math.min(100, R.nitro + 9 * dt);
    if (R.rocketActive > 0) R.nitro = Math.max(0, R.nitro - 6 * dt);

    const kmh = R.speed;
    R.distance += (kmh / 3600) * dt;

    const move = kmh * dt * 0.95;
    moveWorld(move);

    /* steering + road-relative clamp */
    const steerInput = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    R.steer += (steerInput - R.steer) * Math.min(1, dt * (R.assist ? 4.2 : 7.5));
    const lateralSpeed = R.assist ? 9.5 : 13.5;
    R.lane = clamp(R.lane + R.steer * dt * lateralSpeed, -roadWidth/2 + 1.15, roadWidth/2 - 1.15);
    car.position.x = R.lane;
    const carHeading = 0;
    car.rotation.z = lerp(car.rotation.z, -R.steer * 0.17, Math.min(1, dt * 6));
    car.rotation.y = lerp(car.rotation.y, - R.steer * 0.05, Math.min(1, dt * 5));
    const lift = R.rocketActive > 0 ? 1.05 + Math.sin(R.elapsed * 18) * 0.14 : 0;
    const hover = Math.sin(R.elapsed * 7) * 0.045;
    R.rideY = hover + R.jumpOffset + R.slideOffset + lift;
    car.position.y = R.rideY;
    const targetSquash = R.isSliding ? 0.74 : 1;
    car.scale.y = lerp(car.scale.y, targetSquash, Math.min(1, dt * 12));

    const deploy = R.rocketActive > 0 ? 1 : 0;
    animateCar(dt, deploy);
    if (R.rocketActive > 0) R.rocketActive = Math.max(0, R.rocketActive - dt);

    const carLane = R.lane;
    updateObstacles(move, dt, carLane, R.rideY);

    /* camera */
    const speedNorm = clamp(R.speed / 330, 0, 1);
    camera.position.x = lerp(camera.position.x, car.position.x * 0.5, Math.min(1, dt * 2.8));
    camera.position.y = lerp(camera.position.y, 6.4 + (R.rocketActive > 0 ? 1.8 : 0) + speedNorm * 0.45, Math.min(1, dt * 2.4));
    camera.position.z = isPortrait() ? 18 : 15.5;
    camera.lookAt(car.position.x * 0.5, car.position.y + 0.85, -28);
    const targetFov = baseFov() + speedNorm * 4 + (boosting ? 3 : 0) + (R.rocketActive > 0 ? 6 : 0);
    camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 2.2));
    camera.updateProjectionMatrix();

    R.shake = Math.max(0, R.shake - dt * 1.5);
    if (R.shake > 0 && !reduceMotion) {
      camera.position.x += (Math.random() - 0.5) * R.shake * 0.6;
      camera.position.y += (Math.random() - 0.5) * R.shake * 0.5;
    }

    updateStreaks(dt, move, car.position.x);

    R.lastAudio += dt;
    if (R.lastAudio > 0.12) {
      R.lastAudio = 0;
      Sound.updateEngine(R.speed, boosting, R.rocketActive > 0);
    }

    syncHud(boosting);

    if (R.distance >= UNLOCK_KM && !R.rocketUnlocked) {
      R.rocketUnlocked = true;
      showToast('ROCKET PROTOCOL UNLOCKED · PRESS R', 'gold', 2600);
      Sound.tone(520, 0.18, 'triangle', 0.08);
      Sound.tone(780, 0.22, 'triangle', 0.08, 0.1);
    }

    if (R.integrity <= 0) {
      finishRun(false);
      return;
    }
    if (R.mode !== 'endless' && R.distance >= R.length) {
      finishRun(true);
      return;
    }
  }

  function updateObstacles(move, dt, carLane, rideY) {
    const R = run;
    const carTop = rideY + 1.42;
    for (const o of obstacles) {
      o.prevZ = o.z;
      o.z += move;
      if (o.z > 46) {
        respawnObstacle(o, farthestObstacleZ() - rand(52, 92));
        continue;
      }
      const t = trackAt(o.z);
      o.mesh.position.x = t.x + o.lane;
      o.mesh.position.z = o.z;

      if (o.type === 'coin') {
        o.spin += dt * 2.6;
        o.mesh.rotation.set(0, o.spin, 0);
        o.mesh.position.y = 0.95 + Math.sin(R.elapsed * 3 + o.spin) * 0.08;
      } else if (o.type === 'gate') {
        o.spin += dt * 1.1;
        o.mesh.rotation.set(0, t.heading, o.spin);
        o.mesh.scale.setScalar(1 + Math.sin(R.elapsed * 4 + o.spin) * 0.03);
      } else {
        o.mesh.rotation.set(0, t.heading, 0);
        o.mesh.position.y = o.type === 'bar'
          ? 2.15 + Math.sin(R.elapsed * 3 + o.spin) * 0.04
          : 1.05;
      }

      if (o.hit) continue;
      if (!(o.prevZ < CAR_Z && o.z >= CAR_Z)) continue;

      const lateral = Math.abs(o.lane - carLane);
      if (o.type === 'coin') {
        if (lateral < 1.75) collectCoin(o);
        continue;
      }
      if (o.type === 'gate') {
        if (lateral < 1.9) {
          o.hit = true;
          gateHit();
        }
        continue;
      }
      if (o.type === 'bar') {
        /* overhead barrier — slide under it or steer around it */
        if (R.invuln <= 0 && lateral < 3.4 && carTop > 1.06) {
          o.hit = true;
          impactHit();
        }
        continue;
      }
      /* cube — jump over it or steer around it */
      if (R.invuln <= 0 && lateral < 2.35 && rideY < 2.05) {
        o.hit = true;
        impactHit();
      }
      if (state !== 'running') return;
    }
  }

  function doJump() {
    if (state !== 'running' || !run || run.isJumping) return;
    run.isSliding = false;
    run.slideOffset = 0;
    run.isJumping = true;
    run.jumpT = 0;
    Sound.jump();
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function doSlide() {
    if (state !== 'running' || !run || run.isSliding || run.isJumping) return;
    run.isSliding = true;
    run.slideT = 0;
    Sound.slide();
    if (navigator.vibrate) navigator.vibrate(10);
  }

  function collectCoin(o) {
    const R = run;
    o.hit = true;
    R.coins += 1;
    R.coinScore += 50;
    R.nitro = Math.min(100, R.nitro + 3);
    Sound.coin();
    if (ui.coinCount) {
      ui.coinCount.classList.remove('pop');
      void ui.coinCount.offsetWidth;
      ui.coinCount.classList.add('pop');
    }
    if (navigator.vibrate) navigator.vibrate(8);
    respawnObstacle(o, farthestObstacleZ() - rand(52, 92));
  }

  function impactHit() {
    const R = run;
    R.integrity = Math.max(0, R.integrity - 14);
    R.speed *= 0.55;
    R.streak = 0;
    R.shake = 0.55;
    R.invuln = 0.7;
    Sound.impact();
    flash('impact');
    if (navigator.vibrate) navigator.vibrate(45);
    showToast('IMPACT · INTEGRITY ' + Math.round(R.integrity) + '%', 'warn');
  }

  function gateHit() {
    const R = run;
    R.gates += 1;
    R.streak += 1;
    R.nitro = Math.min(100, R.nitro + 20);
    R.integrity = Math.min(100, R.integrity + 3);
    R.gatePoints += 120 * Math.min(R.streak, 5);
    Sound.gate(R.streak);
    flash('gate');
    if (navigator.vibrate) navigator.vibrate(18);
    if (R.streak === 3 || R.streak === 5 || R.streak === 10) {
      showToast('BOOST GATE STREAK ×' + R.streak, 'good', 1600);
    }
  }

  /* ── HUD ────────────────────────────────────────────────── */
  let toastTimer = 0;
  function showToast(message, tone, duration) {
    ui.toast.textContent = message;
    ui.toast.className = 'toast show' + (tone ? ' ' + tone : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.className = 'toast'; }, duration || 2200);
  }

  let flashTimer = 0;
  function flash(kind) {
    if (reduceMotion) return;
    ui.flash.className = '';
    void ui.flash.offsetWidth;
    ui.flash.className = kind;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { ui.flash.className = ''; }, 380);
  }

  function syncHud(boosting) {
    const R = run;
    if (!R) return;
    ui.speed.textContent = pad3(Math.round(R.speed));
    ui.distance.textContent = R.distance.toFixed(2);
    ui.score.textContent = fmt(scoreOf());
    ui.nitroPct.textContent = Math.round(R.nitro) + '%';
    ui.nitroFill.style.width = R.nitro + '%';
    ui.integrity.textContent = Math.round(R.integrity) + '%';
    ui.integrityFill.style.width = R.integrity + '%';
    const integrityColor = R.integrity > 55 ? '#5dffc4' : R.integrity > 25 ? '#ffc857' : '#ff5577';
    ui.integrity.style.color = integrityColor;
    ui.integrityFill.style.background = R.integrity > 55
      ? 'linear-gradient(90deg,#2f8f6e,#5dffc4)'
      : R.integrity > 25
        ? 'linear-gradient(90deg,#8a6a20,#ffc857)'
        : 'linear-gradient(90deg,#7a2233,#ff5577)';

    if (R.rocketActive > 0) {
      ui.rocketState.textContent = 'ACTIVE · ' + R.rocketActive.toFixed(1) + 'S';
      ui.rocketState.style.color = '#52f6ff';
    } else if (R.rocketSpent) {
      ui.rocketState.textContent = 'SPENT · FINISH RUN';
      ui.rocketState.style.color = '#7d92b9';
    } else if (R.rocketUnlocked) {
      ui.rocketState.textContent = 'READY · PRESS R';
      ui.rocketState.style.color = '#ff76df';
    } else {
      ui.rocketState.textContent = 'LOCKED · ' + Math.max(0, UNLOCK_KM - R.distance).toFixed(1) + ' KM';
      ui.rocketState.style.color = '#a3b5d6';
    }
    ui.rocketProgress.style.width = Math.min(100, (R.distance / UNLOCK_KM) * 100) + '%';

    /* coins + jump/slide state (separate from toast so messages still show) */
    if (ui.coinCount) ui.coinCount.textContent = String(R.coins);
    if (ui.actionChip) {
      const action = R.isJumping ? 'JUMP' : R.isSliding ? 'SLIDE' : '';
      ui.actionChip.textContent = action;
      ui.actionChip.className = 'action-chip' + (action ? ' on' : '');
    }

    ui.gateCount.textContent = String(R.gates);
    ui.streak.textContent = '×' + Math.max(1, R.streak);
    ui.streak.classList.toggle('hot', R.streak >= 2);

    const gateEl = ui.streak.parentElement;
    if (gateEl) gateEl.classList.toggle('hot', R.streak >= 2);
  }

  function activateRocket() {
    if (state !== 'running' || !run) return;
    if (!run.rocketUnlocked) {
      showToast('ROCKET LOCKED · COVER ' + UNLOCK_KM.toFixed(1) + ' KM', 'warn', 1600);
      return;
    }
    if (run.rocketSpent) {
      showToast('ROCKET SYSTEM SPENT · FINISH THIS RUN', 'warn', 1600);
      return;
    }
    run.rocketSpent = true;
    run.rocketActive = 4.6;
    run.shake = 0.3;
    Sound.transform();
    showToast('TRANSFORMATION · ROCKETS DEPLOYED', 'good', 2400);
    if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  }

  /* ── results ────────────────────────────────────────────── */
  function finishRun(clear) {
    if (state !== 'running' || !run) return;
    state = 'finished';
    clearInputs();
    Sound.engineActive(false);
    Sound.finish(clear);

    const scoreValue = Math.round(scoreOf(true));
    const record = mode === 'levels' ? save.levels[selectedLevel] : mode === 'custom' ? save.custom : save.endless;
    const previous = record ? Object.assign({}, record) : null;
    const result = saveResult(clear, scoreValue);

    renderResult(clear, scoreValue, result.isBest, previous);
    ui.result.hidden = false;
    if (navigator.vibrate) navigator.vibrate(clear ? [30, 40, 30] : 80);
  }

  function saveResult(clear, scoreValue) {
    let isBest = false;
    const entry = {
      score: scoreValue,
      distance: run.distance,
      gates: run.gates,
      coins: run.coins,
      topSpeed: Math.round(run.topSpeed),
      integrity: Math.round(run.integrity),
      clear: !!clear
    };
    if (mode === 'levels') {
      const prev = save.levels[selectedLevel];
      if (!prev) {
        save.levels[selectedLevel] = entry;
        isBest = true;
      } else {
        if (clear) prev.clear = true;
        if (scoreValue > prev.score) {
          save.levels[selectedLevel] = Object.assign({}, entry, { clear: !!clear || !!prev.clear });
          isBest = true;
        }
      }
    } else if (mode === 'custom') {
      if (scoreValue > (save.custom.score || 0)) {
        save.custom = { score: scoreValue, distance: run.distance, gates: run.gates };
        isBest = true;
      }
    } else {
      if (run.distance > (save.endless.distance || 0)) {
        save.endless = {
          score: Math.max(scoreValue, save.endless.score || 0),
          distance: run.distance,
          gates: run.gates
        };
        isBest = true;
      } else if (scoreValue > (save.endless.score || 0)) {
        save.endless.score = scoreValue;
      }
    }
    persist();
    return { isBest };
  }

  function renderResult(clear, scoreValue, isBest, previous) {
    const layout = LAYOUTS[run.layout];
    ui.resultEyebrow.textContent = run.mode === 'levels'
      ? 'TRIAL ' + pad2(run.level + 1) + ' · ' + LEVELS[run.level].name.toUpperCase()
      : run.mode === 'custom'
        ? 'CUSTOM CIRCUIT · ' + layout.name.toUpperCase()
        : 'ENDLESS PROTOCOL';

    ui.resultTitle.textContent = clear ? (run.mode === 'custom' ? 'CIRCUIT COMPLETE' : 'TRIAL CLEARED') : 'FLIGHT ENDED';

    if (run.mode === 'levels') {
      ui.resultText.textContent = clear
        ? 'Trial ' + pad2(run.level + 1) + ' complete — ' + run.distance.toFixed(2) + ' km through ' + layout.name + ' with ' + Math.round(run.integrity) + '% integrity.'
        : 'Flight ended ' + run.distance.toFixed(2) + ' km into the trial. Repair the chassis and take another run.';
    } else if (run.mode === 'custom') {
      ui.resultText.textContent = clear
        ? 'Circuit complete — ' + run.distance.toFixed(2) + ' km of your own ' + layout.name + '.'
        : 'Circuit ended at ' + run.distance.toFixed(2) + ' km. Adjust the circuit and try again.';
    } else {
      ui.resultText.textContent = 'Flight ended after ' + run.distance.toFixed(2) + ' km, ' + run.gates + ' boost gates and ' + run.coins + ' coins. Every run rewrites the record.';
    }

    ui.resultBadge.classList.toggle('show', !!isBest);
    ui.resultStats.innerHTML = [
      ['DISTANCE', run.distance.toFixed(2) + ' KM'],
      ['COINS', String(run.coins)],
      ['BOOST GATES', String(run.gates)],
      ['TOP SPEED', Math.round(run.topSpeed) + ' KM/H'],
      ['INTEGRITY', Math.round(run.integrity) + '%']
    ].map((s) => '<div class="stat"><small>' + s[0] + '</small><strong>' + s[1] + '</strong></div>').join('');

    ui.resultScore.textContent = fmt(scoreValue);

    const record = mode === 'levels' ? save.levels[selectedLevel] : mode === 'custom' ? save.custom : save.endless;
    const bestText = mode === 'endless'
      ? (record && record.distance ? 'BEST · ' + record.distance.toFixed(2) + ' KM' : '')
      : (record && record.score ? 'BEST · ' + fmt(record.score) : '');
    ui.resultBest.textContent = bestText;

    if (run.mode === 'levels' && clear && run.level < LEVELS.length - 1) {
      nextAction = 'next';
      ui.nextBtn.textContent = 'NEXT TRIAL · ' + pad2(run.level + 2) + ' ↗';
    } else if (run.mode === 'levels') {
      nextAction = 'retry';
      ui.nextBtn.textContent = 'RETRY TRIAL';
    } else if (run.mode === 'custom') {
      nextAction = 'retry';
      ui.nextBtn.textContent = 'RESTART CIRCUIT';
    } else {
      nextAction = 'retry';
      ui.nextBtn.textContent = 'RUN AGAIN';
    }
  }

  /* ── pause / hangar ─────────────────────────────────────── */
  function pauseRun() {
    if (state !== 'running' || !run) return;
    state = 'paused';
    clearInputs();
    ui.pauseStats.innerHTML =
      '<span>DIST ' + run.distance.toFixed(2) + ' KM</span>' +
      '<span>SCORE ' + fmt(scoreOf()) + '</span>' +
      '<span>COINS ' + run.coins + '</span>' +
      '<span>GATES ' + run.gates + '</span>';
    ui.pause.hidden = false;
    Sound.engineActive(false);
    Sound.ui();
  }

  function resumeRun() {
    if (state !== 'paused') return;
    state = 'running';
    ui.pause.hidden = true;
    clearInputs();
    Sound.engineActive(true);
    Sound.ui();
  }

  function backToMenu() {
    state = 'menu';
    run = null;
    clearInputs();
    ui.hud.hidden = true;
    ui.pause.hidden = true;
    ui.result.hidden = true;
    ui.menu.hidden = false;
    Sound.engineActive(false);
    hideObstacles();
    previewWorld();
    refreshMenu();
  }

  /* ── menu ───────────────────────────────────────────────── */
  function isUnlocked(index) {
    return index === 0 || save.allUnlocked || !!(save.levels[index - 1] && save.levels[index - 1].clear);
  }

  function firstUnlocked() {
    for (let i = LEVELS.length - 1; i >= 0; i--) if (isUnlocked(i)) return i;
    return 0;
  }

  function renderLevelSelect() {
    ui.levelSelect.innerHTML = '';
    LEVELS.forEach((level, i) => {
      const unlocked = isUnlocked(i);
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.disabled = !unlocked;
      let label = pad2(i + 1) + ' · ' + level.name;
      if (!unlocked) label += ' — LOCKED';
      else if (save.levels[i]) label += save.levels[i].clear ? '  ✓' : '  •';
      opt.textContent = label;
      ui.levelSelect.appendChild(opt);
    });
    if (!isUnlocked(selectedLevel)) selectedLevel = firstUnlocked();
    ui.levelSelect.value = String(selectedLevel);
    renderLevelInfo();
  }

  function renderLevelInfo() {
    const level = LEVELS[selectedLevel];
    if (!level) return;
    const best = save.levels[selectedLevel];
    const layout = LAYOUTS[level.layout];
    ui.levelInfo.innerHTML =
      '<span class="tag">' + layout.name.toUpperCase() + '</span>' +
      '<b>' + level.km.toFixed(1) + ' KM</b> · ' + Math.round(level.hazard * 100) + '% hazards · speed ×' + level.speed.toFixed(2) +
      (best && best.score
        ? '<span class="best">BEST <strong>' + fmt(best.score) + '</strong> · ' + (best.clear ? 'CLEARED' : 'ATTEMPTED') + '</span>'
        : '<span class="best">' + (isUnlocked(selectedLevel) ? 'NO RECORD YET' : 'LOCKED — CLEAR THE PREVIOUS TRIAL') + '</span>');
    ui.unlockAll.textContent = save.allUnlocked ? 'ALL TRIALS UNLOCKED' : 'UNLOCK ALL TRIALS';
    ui.unlockAll.disabled = !!save.allUnlocked;
  }

  function refreshMenu() {
    document.querySelectorAll('.mode').forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    ui.levelControls.hidden = mode !== 'levels';
    ui.customControls.hidden = mode !== 'custom';
    ui.protocolCount.textContent = mode === 'endless' ? '01 / 03' : mode === 'levels' ? '02 / 03' : '03 / 03';

    const cleared = Object.keys(save.levels).filter((key) => save.levels[key] && save.levels[key].clear).length;
    ui.campaignSub.textContent = cleared > 0 ? cleared + ' of ' + LEVELS.length + ' cleared' : LEVELS.length + ' flight trials';
    ui.footerStats.textContent = cleared + ' / ' + LEVELS.length + ' TRIALS CLEARED';
    ui.heroBest.innerHTML = cleared > 0 || save.endless.distance > 0
      ? 'CAMPAIGN <b>' + cleared + '/' + LEVELS.length + '</b> CLEARED · ENDLESS BEST <b>' + save.endless.distance.toFixed(2) + ' KM</b>'
      : 'NO FLIGHT RECORDS YET — YOUR FIRST IGNITION AWAITS';

    if (mode === 'levels') renderLevelSelect();
    updateSoundButtons();
    updateAssistButton();
  }

  function updateCustomLabels() {
    ui.lengthVal.textContent = (+ui.length.value).toFixed(1) + ' KM';
    ui.trafficVal.textContent = ui.traffic.value + '%';
    ui.layoutDesc.textContent = (LAYOUTS[ui.layout.value] || LAYOUTS.flow).desc;
  }

  function updateSoundButtons() {
    const on = !!save.settings.sound;
    $('soundBtnMenu').textContent = 'SOUND: ' + (on ? 'ON' : 'OFF');
    $('soundBtnPause').textContent = 'SOUND: ' + (on ? 'ON' : 'OFF');
    const hudBtn = $('soundBtnHud');
    hudBtn.classList.toggle('muted', !on);
    hudBtn.setAttribute('aria-pressed', String(on));
  }

  function updateAssistButton() {
    $('assistBtnPause').textContent = 'ASSIST: ' + (save.settings.assist ? 'ON' : 'OFF');
  }

  function toggleSound() {
    save.settings.sound = !save.settings.sound;
    persist();
    Sound.init();
    Sound.setMuted(!save.settings.sound);
    updateSoundButtons();
    if (save.settings.sound) Sound.ui();
  }

  function toggleAssist() {
    save.settings.assist = !save.settings.assist;
    ui.assist.value = save.settings.assist ? 'on' : 'off';
    persist();
    updateAssistButton();
    Sound.ui();
  }

  function applySettings() {
    ui.carColor.value = save.settings.paint;
    ui.roadColor.value = save.settings.glow;
    ui.assist.value = save.settings.assist ? 'on' : 'off';
    ui.layout.value = LAYOUTS[save.settings.layout] ? save.settings.layout : 'flow';
    ui.length.value = save.settings.length;
    ui.traffic.value = save.settings.traffic;
    paintColor = ui.carColor.value;
    roadGlow = ui.roadColor.value;
    updateCustomLabels();
    updateSoundButtons();
    updateAssistButton();
  }

  /* ── input ──────────────────────────────────────────────── */
  const pressed = new Set();
  const touchHeld = { accel: false, brake: false, left: false, right: false, nitro: false, jump: false, slide: false };
  const ACT_KEYS = {
    accel: ['KeyW', 'ArrowUp'],
    brake: ['KeyX'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    nitro: ['ShiftLeft', 'ShiftRight']
  };

  function held(action) {
    if (touchHeld[action]) return true;
    const codes = ACT_KEYS[action];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (pressed.has(codes[i])) return true;
    return false;
  }

  function clearInputs() {
    pressed.clear();
    for (const key in touchHeld) touchHeld[key] = false;
    document.querySelectorAll('.touchbtn.active').forEach((btn) => btn.classList.remove('active'));
  }

  /* ── wiring ─────────────────────────────────────────────── */
  function initMenu() {
    LAYOUT_KEYS.forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = LAYOUTS[key].name;
      ui.layout.appendChild(opt);
    });

    document.querySelectorAll('.mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (mode !== btn.dataset.mode) {
          mode = btn.dataset.mode;
          Sound.init();
          refreshMenu();
          previewWorld();
          Sound.ui();
        }
      });
    });

    ui.levelSelect.addEventListener('change', (e) => {
      selectedLevel = +e.target.value;
      renderLevelInfo();
      previewWorld();
      Sound.ui();
    });

    ui.layout.addEventListener('change', () => {
      save.settings.layout = ui.layout.value;
      persist();
      updateCustomLabels();
      previewWorld();
      Sound.ui();
    });

    ui.length.addEventListener('input', () => {
      save.settings.length = +ui.length.value;
      updateCustomLabels();
    });
    ui.length.addEventListener('change', persist);
    ui.traffic.addEventListener('input', () => {
      save.settings.traffic = +ui.traffic.value;
      updateCustomLabels();
    });
    ui.traffic.addEventListener('change', persist);

    ui.carColor.addEventListener('input', () => {
      paintColor = ui.carColor.value;
      save.settings.paint = paintColor;
      paintMat.color.set(paintColor);
      persist();
    });

    ui.roadColor.addEventListener('input', () => {
      roadGlow = ui.roadColor.value;
      save.settings.glow = roadGlow;
      applyRoadStyle();
      persist();
    });

    ui.assist.addEventListener('change', () => {
      save.settings.assist = ui.assist.value === 'on';
      persist();
      updateAssistButton();
    });

    $('startBtn').addEventListener('click', startRun);
    $('soundBtnMenu').addEventListener('click', toggleSound);
    $('soundBtnPause').addEventListener('click', toggleSound);
    $('soundBtnHud').addEventListener('click', toggleSound);
    $('pauseBtnHud').addEventListener('click', pauseRun);
    $('resumeBtn').addEventListener('click', resumeRun);
    $('restartBtn').addEventListener('click', () => startRun());
    $('menuBtn').addEventListener('click', backToMenu);
    $('resultMenuBtn').addEventListener('click', backToMenu);
    $('assistBtnPause').addEventListener('click', toggleAssist);

    $('nextBtn').addEventListener('click', () => {
      if (nextAction === 'next') selectedLevel = Math.min(LEVELS.length - 1, selectedLevel + 1);
      startRun();
    });

    ui.unlockAll.addEventListener('click', () => {
      save.allUnlocked = true;
      persist();
      refreshMenu();
      Sound.init();
      Sound.ui();
    });

    $('resetProgressBtn').addEventListener('click', () => {
      if (!window.confirm('Reset all trials, records and settings?')) return;
      save = defaultSave();
      selectedLevel = 0;
      applySettings();
      persist();
      refreshMenu();
      previewWorld();
    });

    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && e.code !== 'Escape') return;
      pressed.add(e.code);
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === 'KeyR') activateRocket();
      else if (e.code === 'Space') doJump();
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') doSlide();
      else if (e.code === 'KeyM') toggleSound();
      else if (e.code === 'KeyF') toggleFullscreen();
      else if (e.code === 'Escape') {
        if (state === 'running') pauseRun();
        else if (state === 'paused') resumeRun();
        else if (state === 'finished') backToMenu();
      }
    });
    window.addEventListener('keyup', (e) => pressed.delete(e.code));
    window.addEventListener('blur', () => {
      clearInputs();
      if (state === 'running') pauseRun();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state === 'running') pauseRun();
    });

    document.querySelectorAll('.touchbtn').forEach((btn) => {
      const action = btn.dataset.act;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('active');
        if (action === 'rocket') activateRocket();
        else if (action === 'jump') doJump();
        else if (action === 'slide') doSlide();
        else touchHeld[action] = true;
      };
      const up = (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        if (action === 'accel' || action === 'brake' || action === 'left' || action === 'right' || action === 'nitro') {
          touchHeld[action] = false;
        }
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });
    $('touch').addEventListener('contextmenu', (e) => e.preventDefault());

    initTouchGestures();
    $('fullscreenBtn').addEventListener('click', toggleFullscreen);
  }

  /* swipe up = jump, swipe down = slide, drag sideways = steer */
  function initTouchGestures() {
    const surface = $('game');
    if (!surface) return;
    let id = null;
    let startX = 0;
    let startY = 0;
    let startLane = 0;
    let mode = null;

    surface.addEventListener('pointerdown', (e) => {
      if (state !== 'running' || !run) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      id = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startLane = run.lane;
      mode = null;
      if (surface.setPointerCapture) {
        try { surface.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
    });

    surface.addEventListener('pointermove', (e) => {
      if (id !== e.pointerId || !run || state !== 'running') return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!mode) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        mode = Math.abs(dx) > Math.abs(dy) ? 'steer' : dy < 0 ? 'jump' : 'slide';
        if (mode === 'jump') { doJump(); return; }
        if (mode === 'slide') { doSlide(); return; }
      }
      if (mode === 'steer') {
        const half = roadWidth / 2 - 1.15;
        const travel = Math.max(64, window.innerWidth * 0.26);
        run.lane = clamp(startLane + (dx / travel) * half * 1.35, -half, half);
      }
    });

    const end = (e) => {
      if (id !== e.pointerId) return;
      id = null;
      mode = null;
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('pointerleave', end);

    document.addEventListener('contextmenu', (e) => {
      if (state === 'running') e.preventDefault();
    });
  }

  function toggleFullscreen() {
    const doc = document;
    const el = doc.documentElement;
    const isFull = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!isFull) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        const p = req.call(el);
        if (p && p.catch) p.catch(() => {});
      }
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) {
        const p = exit.call(doc);
        if (p && p.catch) p.catch(() => {});
      }
    }
    Sound.ui();
  }

  /* ── resize + loop + boot ───────────────────────────────── */
  function onResize() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    if (state !== 'running') camera.fov = baseFov();
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2));
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (failed) return;
    if (!lastTime) lastTime = now;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 0.05);
    if (state === 'running') { if (!devFreeze) update(dt); }
    else if (state === 'menu') { if (!devFreeze) updateIdle(dt); }
    renderer.render(scene, camera);
  }

  function init() {
    try {
      init3D();
      initMenu();
      applySettings();
      refreshMenu();
      previewWorld();
      updateSoundButtons();
      requestAnimationFrame(loop);
      setTimeout(() => {
        if (failed) return;
        bootEl.classList.add('done');
        setTimeout(() => { bootEl.hidden = true; }, 550);
      }, 350);
    } catch (err) {
      if (window.console) console.error(err);
      fatal('FLIGHT SYSTEMS FAILED TO INITIALIZE — ' + (err && err.message ? err.message : 'unknown error'));
    }
  }

  init();

  /* dev hook — harmless, useful for tuning and automated checks */
  window.nebulaDrive = {
    get snapshot() {
      return {
        state: state,
        mode: mode,
        paused: !ui.pause.hidden,
        distance: run ? +run.distance.toFixed(3) : 0,
        speed: run ? +run.speed.toFixed(1) : 0,
        integrity: run ? +run.integrity.toFixed(0) : 100,
        gates: run ? run.gates : 0,
        coins: run ? run.coins : 0,
        lane: run ? +run.lane.toFixed(2) : 0,
        isJumping: run ? !!run.isJumping : false,
        isSliding: run ? !!run.isSliding : false,
        rideY: run ? +run.rideY.toFixed(2) : 0,
        rocketUnlocked: run ? !!run.rocketUnlocked : false,
        rocketActive: run ? +run.rocketActive.toFixed(2) : 0,
        obstacles: obstacles.map(function (o) {
          return { z: +o.z.toFixed(1), lane: +o.lane.toFixed(2), type: o.type, hit: o.hit };
        })
      };
    },
    freeze: function (on) { devFreeze = !!on; },
    step: function (seconds) {
      if (state !== 'running' || !run) return null;
      const total = Math.max(1, Math.min(24000, Math.round((seconds || 1) * 60)));
      for (let i = 0; i < total && state === 'running'; i++) update(1 / 60);
      renderer.render(scene, camera);
      return {
        state: state,
        distance: +run.distance.toFixed(3),
        integrity: Math.round(run.integrity),
        gates: run.gates,
        coins: run.coins,
        score: Math.round(scoreOf(true))
      };
    },
    jump: doJump,
    slide: doSlide,
    capture: function (quality) {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/jpeg', quality || 0.8);
    },
    startRun: startRun,
    pauseRun: pauseRun,
    resumeRun: resumeRun,
    backToMenu: backToMenu,
    toggleSound: toggleSound
  };
})();
