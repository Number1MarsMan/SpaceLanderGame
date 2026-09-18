(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  const CANVAS_W = 900;
  const CANVAS_H = 600;
  const PAD_Y = 520;              // y of the ground/pad surface
  let GRAVITY = 28;                // px/s^2, reassigned per-map in resetLander()
  const THRUST_FORCE = 95;        // px/s^2 at mass=1, throttle=100%
  const THROTTLE_RATE = 65;       // %/s ramp speed
  const ANGLE_RATE = 85;          // deg/s rotation speed
  const MAX_ANGLE = 60;           // deg, clamp
  const BURN_RATE = 16;           // fuel units/s at 100% throttle (before budget normalization)
  const SAFE_VY = 42;             // px/s
  const SAFE_VX = 26;             // px/s
  const SAFE_ANGLE = 12;          // deg
  const LANDER_W = 26;
  const LANDER_H = 34;
  const LEG_SPAN = 8;              // how far the legs extend past the hull, in px
  const LANDER_FOOT_Y = LANDER_H / 2 + LEG_SPAN;   // lowest visual point (leg tip) below center
  const LANDER_FOOT_X = LANDER_W / 2 + LEG_SPAN;   // widest visual point (leg tip) from center
  const START_ALT = 430;          // px above pad the lander starts at

  const MASS_MIN = 1.0;
  const MASS_MAX = 1.7;

  const LEVEL_CONFIG = {
    1: { angleControl: false, fuelLimit: false, randomMass: false, padWidth: 300, spawnRangeX: 0 },
    2: { angleControl: true,  fuelLimit: false, randomMass: false, padWidth: 150, spawnRangeX: 260 },
    3: { angleControl: true,  fuelLimit: true,  randomMass: true,  padWidth: 160, spawnRangeX: 200 },
  };

  // ---------------------------------------------------------------------
  // Customization presets (ship / thrust color / map)
  // ---------------------------------------------------------------------
  const SHIP_DESIGNS = [
    { id: 'classic', name: 'Classic Lander',  hullColor: '#d8e2f5', accentColor: '#4d7cff', legColor: '#9fb0d6', draw: (c) => drawHullClassic(c) },
    { id: 'capsule', name: 'Apollo Capsule',  hullColor: '#e8e2d0', accentColor: '#ffd24d', legColor: '#b0a480', draw: (c) => drawHullCapsule(c) },
    { id: 'shuttle', name: 'Delta Shuttle',   hullColor: '#d0d8e8', accentColor: '#4dd9ff', legColor: '#5f6f95', draw: (c) => drawHullShuttle(c) },
    { id: 'saucer',  name: 'Saucer Disc',     hullColor: '#c9d4e8', accentColor: '#b34dff', legColor: '#9fb8e0', draw: (c) => drawHullSaucer(c) },
    { id: 'rocket',  name: 'Cylinder Rocket', hullColor: '#d8dce2', accentColor: '#4dff88', legColor: '#b33d3d', draw: (c) => drawHullRocket(c) },
  ];

  const THRUST_PRESETS = [
    { id: 'orange', name: 'Classic Orange',  core: '#fff2b0', mid: '#ff9a3d', tail: 'rgba(255,60,20,0)' },
    { id: 'ion',    name: 'Blue Ion',        core: '#eaf6ff', mid: '#4da6ff', tail: 'rgba(20,80,255,0)' },
    { id: 'plasma', name: 'Green Plasma',    core: '#eaffea', mid: '#4dff88', tail: 'rgba(20,180,60,0)' },
    { id: 'exotic', name: 'Purple Exotic',   core: '#f5eaff', mid: '#b34dff', tail: 'rgba(120,20,200,0)' },
    { id: 'after',  name: 'Red Afterburner', core: '#fff0ea', mid: '#ff4d4d', tail: 'rgba(200,20,20,0)' },
    { id: 'white',  name: 'White-Hot',       core: '#ffffff', mid: '#cfe8ff', tail: 'rgba(200,220,255,0)' },
  ];

  // Gravity chosen thematically: asteroid (near-weightless) < ice (small icy
  // moon) < lunar (today's original baseline) < mars < toxic (heaviest/hardest).
  const MAP_PRESETS = [
    { id: 'lunar',    name: 'Lunar Surface',       gravity: 28,
      skyTop: '#05070d', skyBottom: '#0b1226', terrainFill: '#161d33', terrainStroke: '#2c3a63',
      starColor: '#cfe0ff', starDensity: 140 },
    { id: 'asteroid', name: 'Deep Space Asteroid', gravity: 12,
      skyTop: '#020204', skyBottom: '#07080f', terrainFill: '#2a2a30', terrainStroke: '#45454f',
      starColor: '#e8edf7', starDensity: 200 },
    { id: 'ice',      name: 'Ice World',           gravity: 20,
      skyTop: '#030a12', skyBottom: '#0a1c2e', terrainFill: '#1b3a4a', terrainStroke: '#2f5b6e',
      starColor: '#d7f3ff', starDensity: 160 },
    { id: 'mars',     name: 'Mars Basin',          gravity: 34,
      skyTop: '#1a0805', skyBottom: '#3a140a', terrainFill: '#4a2418', terrainStroke: '#6b3624',
      starColor: '#ffd9c2', starDensity: 90 },
    { id: 'toxic',    name: 'Toxic Alien World',   gravity: 36,
      skyTop: '#0a1006', skyBottom: '#16240a', terrainFill: '#24331a', terrainStroke: '#3c5426',
      starColor: '#c8ff9a', starDensity: 100 },
  ];

  const DEFAULT_SETTINGS = {
    shipId: 'classic', thrustId: 'orange', mapId: 'lunar',
    craters: false, planets: false, shootingStars: false, nebula: false, asteroids: false,
  };
  const SETTINGS_KEY = 'landerSettings';

  const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', LANDED: 'landed', CRASHED: 'crashed', CRASH_ANIM: 'crash_anim' };
  const CRASH_ANIM_DURATION = 1.6; // seconds of debris animation before the end overlay appears
  const DEBRIS_GRAVITY = 340;      // px/s^2, heavier than flight gravity so debris settles fast
  const GROUND_FRICTION = 0.72;    // horizontal velocity retained per bounce

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const appEl = document.getElementById('app');

  // The game area is always rendered/laid out in a fixed 900x600 logical
  // coordinate space (CANVAS_W x CANVAS_H); fitStage() scales that whole
  // stage up or down via CSS transform to fill as much of the browser
  // window as it can while preserving the 3:2 aspect ratio. The canvas's
  // own backing-store resolution is boosted to match (scale * devicePixelRatio)
  // so it stays crisp instead of blurring when stretched larger than 900x600.
  let stageScale = 1;
  let canvasPixelRatio = 1;

  function fitStage() {
    const MAX_SCALE = 3.5; // safety clamp for pathologically large/high-DPI displays
    stageScale = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H, MAX_SCALE);
    appEl.style.transform = `scale(${stageScale})`;

    canvasPixelRatio = (window.devicePixelRatio || 1) * stageScale;
    canvas.width = Math.round(CANVAS_W * canvasPixelRatio);
    canvas.height = Math.round(CANVAS_H * canvasPixelRatio);
    canvas.style.width = CANVAS_W + 'px';
    canvas.style.height = CANVAS_H + 'px';
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  const hudAlt = document.getElementById('hud-alt');
  const hudVSpeed = document.getElementById('hud-vspeed');
  const hudHSpeed = document.getElementById('hud-hspeed');
  const hudAngle = document.getElementById('hud-angle');
  const hudFuel = document.getElementById('hud-fuel');
  const hudMass = document.getElementById('hud-mass');
  const hudHSpeedRow = document.getElementById('hud-hspeed-row');
  const hudAngleRow = document.getElementById('hud-angle-row');
  const hudFuelRow = document.getElementById('hud-fuel-row');
  const hudMassRow = document.getElementById('hud-mass-row');

  const throttleFill = document.getElementById('throttle-fill');
  const throttlePct = document.getElementById('throttle-pct');
  const engineStatus = document.getElementById('engine-status');
  const controlsLegend = document.getElementById('controls-legend');

  const menuOverlay = document.getElementById('menu-overlay');
  const endOverlay = document.getElementById('end-overlay');
  const pauseOverlay = document.getElementById('pause-overlay');
  const endTitle = document.getElementById('end-title');
  const endMessage = document.getElementById('end-message');
  const retryBtn = document.getElementById('retry-btn');
  const menuBtn = document.getElementById('menu-btn');

  const customizeBtn = document.getElementById('customize-btn');
  const customizerOverlay = document.getElementById('customizer-overlay');
  const customizerBackBtn = document.getElementById('customizer-back-btn');
  const shipOptionsEl = document.getElementById('ship-options');
  const thrustOptionsEl = document.getElementById('thrust-options');
  const mapOptionsEl = document.getElementById('map-options');
  const toggleCraters = document.getElementById('toggle-craters');
  const togglePlanets = document.getElementById('toggle-planets');
  const toggleShooting = document.getElementById('toggle-shooting');
  const toggleNebula = document.getElementById('toggle-nebula');
  const toggleAsteroids = document.getElementById('toggle-asteroids');

  // ---------------------------------------------------------------------
  // Settings persistence
  // ---------------------------------------------------------------------
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  let settings = loadSettings();
  let activeShip = SHIP_DESIGNS.find((s) => s.id === settings.shipId) || SHIP_DESIGNS[0];
  let activeThrust = THRUST_PRESETS.find((t) => t.id === settings.thrustId) || THRUST_PRESETS[0];
  let activeMap = MAP_PRESETS.find((m) => m.id === settings.mapId) || MAP_PRESETS[0];

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  let state = STATE.MENU;
  let level = 1;
  let cfg = LEVEL_CONFIG[1];
  let stars = [];
  let terrain = null;

  let lander = null;
  let keys = {};
  let lastTime = null;

  let debris = [];
  let sparks = [];
  let crashTimer = 0;
  let pendingCrashMessage = '';
  let shakeMag = 0;

  let craters = [];
  let planets = [];
  let nebulaClouds = [];
  let asteroids = [];
  let shootingStars = [];
  let shootingStarTimer = 2;

  function makeStars() {
    const arr = [];
    for (let i = 0; i < activeMap.starDensity; i++) {
      arr.push({
        x: Math.random() * CANVAS_W,
        y: Math.random() * (PAD_Y - 10),
        r: Math.random() * 1.4 + 0.3,
        tw: Math.random() * Math.PI * 2,
      });
    }
    return arr;
  }

  function makeTerrain(padCenter, padWidth) {
    // Build a jagged terrain line across the canvas with a flat pad segment.
    const padLeft = padCenter - padWidth / 2;
    const padRight = padCenter + padWidth / 2;
    const points = [];
    const step = 30;
    let x = 0;
    while (x <= CANVAS_W) {
      if (x >= padLeft - step && x <= padRight + step) {
        // near/within pad -> flatten
        points.push({ x, y: PAD_Y });
      } else {
        const roughness = Math.sin(x * 0.02) * 18 + Math.sin(x * 0.055) * 10;
        points.push({ x, y: PAD_Y + 10 + roughness + (Math.random() * 6 - 3) });
      }
      x += step;
    }
    // ensure exact pad edges are flat at PAD_Y
    points.push({ x: CANVAS_W, y: PAD_Y + 10 });
    return { points, padLeft, padRight };
  }

  // ---------------------------------------------------------------------
  // Fuel budget calculation (level 3) — guarantees a feasible minimum-fuel
  // trajectory exists for the randomly chosen mass, then adds a generous
  // safety margin for imperfect human piloting + horizontal correction.
  // ---------------------------------------------------------------------
  function computeFuelBudget(mass, startAltitude, gravity) {
    const aMax = THRUST_FORCE / mass;
    const netDecel = Math.max(aMax - gravity, 1);
    const v0 = Math.sqrt(2 * gravity * startAltitude * netDecel / aMax);
    const tBurn = v0 / netDecel;
    const fuelMin = BURN_RATE * tBurn;
    return fuelMin * 3.2 + 45; // margin factor + flat buffer for maneuvering
  }

  function resetLander() {
    cfg = LEVEL_CONFIG[level];
    activeShip = SHIP_DESIGNS.find((s) => s.id === settings.shipId) || SHIP_DESIGNS[0];
    activeThrust = THRUST_PRESETS.find((t) => t.id === settings.thrustId) || THRUST_PRESETS[0];
    activeMap = MAP_PRESETS.find((m) => m.id === settings.mapId) || MAP_PRESETS[0];
    GRAVITY = activeMap.gravity;

    const padCenter = CANVAS_W / 2;
    terrain = makeTerrain(padCenter, cfg.padWidth);
    stars = makeStars();
    craters = makeCraters();
    planets = makePlanets();
    nebulaClouds = makeNebulaClouds();
    asteroids = makeAsteroidField();
    shootingStars = [];
    shootingStarTimer = 1 + Math.random() * 2;
    debris = [];
    sparks = [];
    crashTimer = 0;
    shakeMag = 0;

    const spawnX = cfg.spawnRangeX > 0
      ? padCenter + (Math.random() * 2 - 1) * cfg.spawnRangeX
      : padCenter;

    const mass = cfg.randomMass
      ? +(MASS_MIN + Math.random() * (MASS_MAX - MASS_MIN)).toFixed(2)
      : 1.0;

    const maxFuel = cfg.fuelLimit ? computeFuelBudget(mass, START_ALT, GRAVITY) : Infinity;

    lander = {
      x: spawnX,
      y: PAD_Y - START_ALT,
      vx: 0,
      vy: 0,
      angle: 0, // degrees, 0 = upright
      throttle: 0,
      engineOn: false,
      mass,
      fuel: maxFuel,
      maxFuel,
      padCenter,
    };

    // HUD visibility per level
    hudHSpeedRow.style.display = cfg.angleControl ? '' : 'none';
    hudAngleRow.style.display = cfg.angleControl ? '' : 'none';
    hudFuelRow.style.display = cfg.fuelLimit ? '' : 'none';
    hudMassRow.style.display = cfg.randomMass ? '' : 'none';

    const rows = [
      { label: 'Engine', key: 'Space' },
      { label: 'Throttle', key: '&uarr; / &darr;' },
    ];
    if (cfg.angleControl) rows.push({ label: 'Rotate', key: '&larr; / &rarr;' });
    rows.push({ label: 'Restart', key: 'R' });
    rows.push({ label: 'Pause', key: 'P' });

    controlsLegend.innerHTML = '<div class="legend-title">Controls</div>' +
      rows.map((r) => `<div class="ctrl-row"><span class="label">${r.label}</span><span class="ctrl-key">${r.key}</span></div>`).join('');
  }

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------
  function update(dt) {
    updateDecorations(dt);
    if (state === STATE.CRASH_ANIM) { updateCrashAnimation(dt); return; }
    if (state !== STATE.PLAYING) return;

    // Throttle input
    if (keys['ArrowUp']) {
      lander.throttle = Math.min(100, lander.throttle + THROTTLE_RATE * dt);
    }
    if (keys['ArrowDown']) {
      lander.throttle = Math.max(0, lander.throttle - THROTTLE_RATE * dt);
    }

    // Angle input
    if (cfg.angleControl) {
      if (keys['ArrowLeft']) {
        lander.angle = Math.max(-MAX_ANGLE, lander.angle - ANGLE_RATE * dt);
      }
      if (keys['ArrowRight']) {
        lander.angle = Math.min(MAX_ANGLE, lander.angle + ANGLE_RATE * dt);
      }
    }

    const hasFuel = !cfg.fuelLimit || lander.fuel > 0;
    const effectiveThrottle = (hasFuel && lander.engineOn) ? lander.throttle : 0;

    const accel = (effectiveThrottle / 100) * THRUST_FORCE / lander.mass;
    const rad = lander.angle * Math.PI / 180;
    const ax = Math.sin(rad) * accel;
    const ay = -Math.cos(rad) * accel + GRAVITY;

    lander.vx += ax * dt;
    lander.vy += ay * dt;
    lander.x += lander.vx * dt;
    lander.y += lander.vy * dt;

    // soft walls
    if (lander.x < 20) { lander.x = 20; lander.vx = Math.max(0, lander.vx); }
    if (lander.x > CANVAS_W - 20) { lander.x = CANVAS_W - 20; lander.vx = Math.min(0, lander.vx); }
    if (lander.y < 10) { lander.y = 10; lander.vy = Math.max(0, lander.vy); }

    if (cfg.fuelLimit && effectiveThrottle > 0) {
      lander.fuel = Math.max(0, lander.fuel - (effectiveThrottle / 100) * BURN_RATE * dt);
    }

    // Ground / pad collision — lowest visual point (leg tips) vs PAD_Y
    const bottomY = lander.y + LANDER_FOOT_Y;
    if (bottomY >= PAD_Y) {
      lander.y = PAD_Y - LANDER_FOOT_Y;
      resolveTouchdown();
    }

    updateHud();
  }

  function resolveTouchdown() {
    const onPad = lander.x >= terrain.padLeft + LANDER_FOOT_X && lander.x <= terrain.padRight - LANDER_FOOT_X;
    const vyOk = Math.abs(lander.vy) <= SAFE_VY;
    const vxOk = !cfg.angleControl || Math.abs(lander.vx) <= SAFE_VX;
    const angleOk = !cfg.angleControl || Math.abs(lander.angle) <= SAFE_ANGLE;

    if (onPad && vyOk && vxOk && angleOk) {
      state = STATE.LANDED;
      showEnd(true, buildSuccessMessage());
    } else {
      pendingCrashMessage = buildFailMessage(onPad, vyOk, vxOk, angleOk);
      startCrashAnimation();
    }
  }

  // ---------------------------------------------------------------------
  // Crash explosion — breaks the lander into flying debris pieces and
  // sparks, then hands off to the normal end-overlay once it settles.
  // ---------------------------------------------------------------------
  function terrainHeightAt(x) {
    const pts = terrain.points;
    if (x <= pts[0].x) return pts[0].y;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / (b.x - a.x || 1);
        return a.y + (b.y - a.y) * t;
      }
    }
    return pts[pts.length - 1].y;
  }

  // Darkens/lightens a #rrggbb hex color by `amt` (-1..1) — used to derive
  // subtle hull-piece shading variants from a ship's single hullColor.
  function shadeHex(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const clamp = (v) => Math.max(0, Math.min(255, v));
    const r = clamp(((n >> 16) & 0xff) + Math.round(255 * amt));
    const g = clamp(((n >> 8) & 0xff) + Math.round(255 * amt));
    const b = clamp((n & 0xff) + Math.round(255 * amt));
    return `rgb(${r},${g},${b})`;
  }

  function startCrashAnimation() {
    state = STATE.CRASH_ANIM;
    crashTimer = CRASH_ANIM_DURATION;
    shakeMag = 10;

    const L = lander;
    const impactSpeed = Math.hypot(L.vx, L.vy);
    const rad = L.angle * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // rotate a local-space point into world space at the lander's pose
    const toWorld = (lx, ly) => ({ x: L.x + lx * cos - ly * sin, y: L.y + lx * sin + ly * cos });

    const hull = activeShip.hullColor;
    const PIECE_DEFS = [
      { pts: [[0, -17], [8, -2], [-8, -2]], color: shadeHex(hull, 0.06) },        // nose cone
      { pts: [[-13, -2], [0, -2], [0, 11], [-13, 11]], color: shadeHex(hull, -0.05) },  // left hull
      { pts: [[0, -2], [13, -2], [13, 11], [0, 11]], color: shadeHex(hull, -0.12) },    // right hull
      { pts: [[-13, 5], [-21, 19], [-9, 13]], color: activeShip.legColor },       // left leg
      { pts: [[13, 5], [21, 19], [9, 13]], color: activeShip.legColor },         // right leg
      { pts: [[-5, -8], [5, -8], [4, 2], [-4, 2]], color: activeShip.accentColor },  // cockpit window
    ];

    debris = PIECE_DEFS.map((def) => {
      const centroid = def.pts.reduce((a, p) => [a[0] + p[0] / def.pts.length, a[1] + p[1] / def.pts.length], [0, 0]);
      const world = toWorld(centroid[0], centroid[1]);
      const outward = Math.atan2(centroid[1], centroid[0] || 0.001);
      const kick = 60 + impactSpeed * 0.6 + Math.random() * 90;
      return {
        pts: def.pts.map(([px, py]) => [px - centroid[0], py - centroid[1]]),
        color: def.color,
        x: world.x,
        y: world.y,
        vx: L.vx * 0.4 + Math.cos(outward + rad) * kick * (0.4 + Math.random() * 0.6),
        vy: L.vy * 0.3 + Math.sin(outward + rad) * kick * (0.4 + Math.random() * 0.6) - 70 - Math.random() * 60,
        angle: L.angle,
        angularVel: (Math.random() - 0.5) * 420,
        resting: false,
      };
    });

    sparks = [];
    const sparkCount = 22;
    for (let i = 0; i < sparkCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 220;
      sparks.push({
        x: L.x, y: L.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 40,
        life: 0.25 + Math.random() * 0.35,
        age: 0,
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  function updateCrashAnimation(dt) {
    crashTimer -= dt;
    shakeMag = Math.max(0, shakeMag - dt * 22);

    for (const p of debris) {
      if (p.resting) continue;
      p.vy += DEBRIS_GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.angularVel * dt;

      const groundY = terrainHeightAt(Math.max(0, Math.min(CANVAS_W, p.x)));
      if (p.y >= groundY) {
        p.y = groundY;
        if (Math.abs(p.vy) > 25) {
          p.vy *= -0.38;
          p.vx *= GROUND_FRICTION;
          p.angularVel *= 0.5;
        } else {
          p.vy = 0;
          p.vx *= 0.6;
          p.angularVel *= 0.6;
          if (Math.abs(p.vx) < 3 && Math.abs(p.angularVel) < 8) p.resting = true;
        }
      }
    }

    for (const s of sparks) {
      s.age += dt;
      s.vy += 200 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    sparks = sparks.filter((s) => s.age < s.life);

    if (crashTimer <= 0) {
      state = STATE.CRASHED;
      showEnd(false, pendingCrashMessage);
    }
  }

  function buildSuccessMessage() {
    let msg = `Touchdown speed: ${Math.abs(lander.vy).toFixed(1)} m/s vertical`;
    if (cfg.angleControl) msg += `, ${Math.abs(lander.vx).toFixed(1)} m/s horizontal, ${Math.abs(lander.angle).toFixed(1)}&deg; tilt`;
    if (cfg.fuelLimit) msg += `. Fuel remaining: ${Math.round(100 * lander.fuel / lander.maxFuel)}%`;
    return msg + '.';
  }

  function buildFailMessage(onPad, vyOk, vxOk, angleOk) {
    const reasons = [];
    if (!onPad) reasons.push('missed the landing pad');
    if (!vyOk) reasons.push('descended too fast');
    if (!vxOk) reasons.push('too much horizontal speed');
    if (!angleOk) reasons.push('lander was tilted too far');
    if (reasons.length === 0) reasons.push('impact conditions exceeded safe limits');
    return 'Crashed: ' + reasons.join(', ') + '.';
  }

  function showEnd(success, message) {
    endOverlay.classList.remove('hidden');
    endTitle.textContent = success ? 'Landed!' : 'Crashed';
    endTitle.className = success ? 'success' : 'fail';
    endMessage.innerHTML = message;
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------
  function updateHud() {
    const altitude = Math.max(0, PAD_Y - (lander.y + LANDER_FOOT_Y));
    hudAlt.textContent = altitude.toFixed(0);
    hudVSpeed.textContent = (-lander.vy).toFixed(1);
    hudHSpeed.textContent = lander.vx.toFixed(1);
    hudAngle.textContent = lander.angle.toFixed(0);
    hudFuel.textContent = cfg.fuelLimit ? Math.round(100 * lander.fuel / lander.maxFuel) : 100;
    hudMass.textContent = lander.mass.toFixed(2);

    throttleFill.style.height = lander.throttle.toFixed(0) + '%';
    throttlePct.textContent = Math.round(lander.throttle) + '%';
    engineStatus.textContent = lander.engineOn ? 'ENGINE ON' : 'ENGINE OFF';
    engineStatus.className = lander.engineOn ? 'engine-on' : 'engine-off';
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  function render(t) {
    // Map logical 900x600 drawing coordinates onto the (possibly higher-res)
    // backing store set up in fitStage(), so all draw calls below can stay
    // written in logical units.
    ctx.setTransform(canvasPixelRatio, 0, 0, canvasPixelRatio, 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    if (shakeMag > 0.1) {
      ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
    }

    // sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, activeMap.skyTop);
    grad.addColorStop(1, activeMap.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (settings.nebula) drawNebula(t);
    if (settings.planets) drawPlanets();

    // stars
    ctx.fillStyle = activeMap.starColor;
    for (const s of stars) {
      const twinkle = 0.6 + 0.4 * Math.sin(t / 500 + s.tw);
      ctx.globalAlpha = twinkle;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (settings.asteroids) drawAsteroidField();
    if (settings.shootingStars) drawShootingStars();

    if (terrain) drawTerrain();

    if (state === STATE.CRASH_ANIM || (debris.length && state === STATE.CRASHED)) {
      drawDebris();
      drawSparks();
    } else if (lander) {
      drawLander();
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // Decorative scene layers (all cosmetic — never touch terrain.points or
  // any collision/physics state)
  // ---------------------------------------------------------------------
  function makeCraters() {
    if (!terrain) return [];
    const list = [];
    const count = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      let x;
      let attempts = 0;
      do {
        x = Math.random() * CANVAS_W;
        attempts++;
      } while (x > terrain.padLeft - 40 && x < terrain.padRight + 40 && attempts < 10);
      if (x > terrain.padLeft - 40 && x < terrain.padRight + 40) continue;
      const y = terrainHeightAt(x);
      const rx = 8 + Math.random() * 18;
      const ry = rx * (0.28 + Math.random() * 0.12);
      list.push({ x, y, rx, ry });
    }
    return list;
  }

  function makePlanets() {
    const count = 1 + Math.floor(Math.random() * 2);
    const palette = ['#7f93bf', '#b39ddb', '#8fd0c9', '#d19a6a', '#c98fa0'];
    const list = [];
    for (let i = 0; i < count; i++) {
      const r = 18 + Math.random() * 30;
      list.push({
        x: 80 + Math.random() * (CANVAS_W - 160),
        y: 40 + Math.random() * 160,
        r,
        color: palette[Math.floor(Math.random() * palette.length)],
        ring: Math.random() < 0.3,
      });
    }
    return list;
  }

  function makeNebulaClouds() {
    const list = [];
    const palette = ['rgba(180,120,255,0.10)', 'rgba(90,200,255,0.09)', 'rgba(255,120,180,0.08)'];
    for (let i = 0; i < 4; i++) {
      list.push({
        x: Math.random() * CANVAS_W,
        y: 30 + Math.random() * 260,
        rx: 120 + Math.random() * 160,
        ry: 50 + Math.random() * 60,
        color: palette[i % palette.length],
        drift: (Math.random() - 0.5) * 3,
      });
    }
    return list;
  }

  function makeAsteroidField() {
    const list = [];
    const count = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const r = 3 + Math.random() * 6;
      const pts = [];
      const sides = 5 + Math.floor(Math.random() * 3);
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const rr = r * (0.7 + Math.random() * 0.5);
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      list.push({
        x: Math.random() * CANVAS_W,
        y: 20 + Math.random() * 300,
        pts,
        angle: Math.random() * 360,
        angularVel: (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 4,
      });
    }
    return list;
  }

  function updateDecorations(dt) {
    if (settings.asteroids) {
      for (const a of asteroids) {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.angle += a.angularVel * dt;
        if (a.x < -20) a.x = CANVAS_W + 20;
        if (a.x > CANVAS_W + 20) a.x = -20;
        if (a.y < -20) a.y = 320;
        if (a.y > 320) a.y = -20;
      }
    }
    if (settings.nebula) {
      for (const n of nebulaClouds) {
        n.x += n.drift * dt;
        if (n.x < -200) n.x = CANVAS_W + 200;
        if (n.x > CANVAS_W + 200) n.x = -200;
      }
    }
    if (settings.shootingStars) {
      shootingStarTimer -= dt;
      if (shootingStarTimer <= 0) {
        shootingStarTimer = 1.5 + Math.random() * 3;
        const startX = Math.random() * CANVAS_W * 0.6;
        shootingStars.push({
          x: startX, y: 20 + Math.random() * 100,
          vx: 260 + Math.random() * 140, vy: 90 + Math.random() * 50,
          life: 0.6, age: 0,
        });
      }
      for (const s of shootingStars) {
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }
      shootingStars = shootingStars.filter((s) => s.age < s.life);
    }
  }

  function drawNebula(t) {
    for (const n of nebulaClouds) {
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.rx);
      grad.addColorStop(0, n.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.scale(1, n.ry / n.rx);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, n.rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPlanets() {
    for (const p of planets) {
      if (p.ring) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-0.35);
        ctx.strokeStyle = 'rgba(230, 220, 200, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 1.7, p.r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
  }

  function drawAsteroidField() {
    ctx.fillStyle = 'rgba(160, 160, 175, 0.55)';
    for (const a of asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle * Math.PI / 180);
      ctx.beginPath();
      a.pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawShootingStars() {
    for (const s of shootingStars) {
      const life = 1 - s.age / s.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, life);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.05, s.y - s.vy * 0.05);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawDebris() {
    for (const p of debris) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle * Math.PI / 180);
      ctx.beginPath();
      p.pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSparks() {
    for (const s of sparks) {
      const life = 1 - s.age / s.life;
      ctx.globalAlpha = Math.max(0, life);
      ctx.fillStyle = life > 0.5 ? activeThrust.core : activeThrust.mid;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCraters() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    for (const c of craters) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawTerrain() {
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    for (const p of terrain.points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(CANVAS_W, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = activeMap.terrainFill;
    ctx.fill();
    ctx.strokeStyle = activeMap.terrainStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(terrain.points[0].x, terrain.points[0].y);
    for (const p of terrain.points) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    if (settings.craters) drawCraters();

    // pad markers
    ctx.strokeStyle = '#6fe08a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(terrain.padLeft, PAD_Y);
    ctx.lineTo(terrain.padRight, PAD_Y);
    ctx.stroke();

    // pad lights
    ctx.fillStyle = '#6fe08a';
    for (let x = terrain.padLeft; x <= terrain.padRight; x += 20) {
      ctx.beginPath();
      ctx.arc(x, PAD_Y + 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLander() {
    ctx.save();
    ctx.translate(lander.x, lander.y);
    ctx.rotate(lander.angle * Math.PI / 180);

    const hasFuel = !cfg.fuelLimit || lander.fuel > 0;
    const flameOn = lander.throttle > 4 && hasFuel && lander.engineOn;
    const flameStrength = lander.throttle / 100;
    drawFlame(ctx, activeThrust, flameOn, flameStrength);
    (activeShip || SHIP_DESIGNS[0]).draw(ctx);

    ctx.restore();
  }

  // Shared flame — every ship design shares the same anchor/shape, only the
  // color preset varies. `ctx` is passed explicitly so ship-preview canvases
  // (which use their own 2D context) could reuse this too, though previews
  // draw with flameOn=false.
  function drawFlame(c, preset, on, strength) {
    if (!on) return;
    const flameLen = 10 + strength * 26 * (0.7 + 0.3 * Math.random());
    c.beginPath();
    c.moveTo(-7, LANDER_H / 2);
    c.lineTo(0, LANDER_H / 2 + flameLen);
    c.lineTo(7, LANDER_H / 2);
    c.closePath();
    const fgrad = c.createLinearGradient(0, LANDER_H / 2, 0, LANDER_H / 2 + flameLen);
    fgrad.addColorStop(0, preset.core);
    fgrad.addColorStop(0.5, preset.mid);
    fgrad.addColorStop(1, preset.tail);
    c.fillStyle = fgrad;
    c.fill();
  }

  // Shared leg geometry — fixed anchor points so every ship's legs line up
  // with the real collision footprint (LANDER_FOOT_X/Y) regardless of hull.
  function drawLegs(c, color) {
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-LANDER_W / 2, LANDER_H / 2 - 6);
    c.lineTo(-LANDER_W / 2 - 8, LANDER_H / 2 + 8);
    c.moveTo(LANDER_W / 2, LANDER_H / 2 - 6);
    c.lineTo(LANDER_W / 2 + 8, LANDER_H / 2 + 8);
    c.stroke();
  }

  function drawHullClassic(c) {
    const ship = SHIP_DESIGNS[0];
    c.beginPath();
    c.moveTo(0, -LANDER_H / 2);
    c.lineTo(LANDER_W / 2, LANDER_H / 2 - 6);
    c.lineTo(LANDER_W / 2, LANDER_H / 2);
    c.lineTo(-LANDER_W / 2, LANDER_H / 2);
    c.lineTo(-LANDER_W / 2, LANDER_H / 2 - 6);
    c.closePath();
    c.fillStyle = ship.hullColor;
    c.fill();
    c.strokeStyle = '#7f93bf';
    c.lineWidth = 1.5;
    c.stroke();

    c.beginPath();
    c.arc(0, -4, 5, 0, Math.PI * 2);
    c.fillStyle = ship.accentColor;
    c.fill();

    drawLegs(c, ship.legColor);
  }

  function drawHullCapsule(c) {
    const ship = SHIP_DESIGNS[1];
    c.beginPath();
    c.moveTo(0, -LANDER_H / 2);
    c.quadraticCurveTo(LANDER_W / 2 + 2, -6, LANDER_W / 2 - 3, LANDER_H / 2);
    c.lineTo(-(LANDER_W / 2 - 3), LANDER_H / 2);
    c.quadraticCurveTo(-(LANDER_W / 2 + 2), -6, 0, -LANDER_H / 2);
    c.closePath();
    c.fillStyle = ship.hullColor;
    c.fill();
    c.strokeStyle = '#b0a480';
    c.lineWidth = 1.5;
    c.stroke();

    c.beginPath();
    c.arc(0, -6, 4.5, 0, Math.PI * 2);
    c.fillStyle = ship.accentColor;
    c.fill();

    drawLegs(c, ship.legColor);
  }

  function drawHullShuttle(c) {
    const ship = SHIP_DESIGNS[2];
    // delta wings, drawn first so the fuselage overlaps their inner edge
    c.beginPath();
    c.moveTo(-6, 2);
    c.lineTo(-(LANDER_W / 2 + 2), LANDER_H / 2 - 2);
    c.lineTo(-6, LANDER_H / 2 - 2);
    c.closePath();
    c.moveTo(6, 2);
    c.lineTo(LANDER_W / 2 + 2, LANDER_H / 2 - 2);
    c.lineTo(6, LANDER_H / 2 - 2);
    c.closePath();
    c.fillStyle = '#5f6f95';
    c.fill();

    c.beginPath();
    c.moveTo(0, -LANDER_H / 2);
    c.lineTo(7, LANDER_H / 2 - 4);
    c.lineTo(7, LANDER_H / 2);
    c.lineTo(-7, LANDER_H / 2);
    c.lineTo(-7, LANDER_H / 2 - 4);
    c.closePath();
    c.fillStyle = ship.hullColor;
    c.fill();
    c.strokeStyle = '#5f6f95';
    c.lineWidth = 1.5;
    c.stroke();

    c.beginPath();
    c.arc(0, -2, 4, 0, Math.PI * 2);
    c.fillStyle = ship.accentColor;
    c.fill();

    drawLegs(c, ship.legColor);
  }

  function drawHullSaucer(c) {
    const ship = SHIP_DESIGNS[3];
    c.beginPath();
    c.ellipse(0, 2, LANDER_W / 2 + 2, 7, 0, 0, Math.PI * 2);
    c.fillStyle = ship.hullColor;
    c.fill();
    c.strokeStyle = '#9fb8e0';
    c.lineWidth = 1.5;
    c.stroke();

    c.beginPath();
    c.arc(0, -4, 8, Math.PI, 0);
    c.closePath();
    c.fillStyle = '#9fb8e0';
    c.fill();

    c.beginPath();
    c.arc(0, -4, 4, 0, Math.PI * 2);
    c.fillStyle = ship.accentColor;
    c.fill();

    drawLegs(c, ship.legColor);
  }

  function drawHullRocket(c) {
    const ship = SHIP_DESIGNS[4];
    // fins
    c.beginPath();
    c.moveTo(-6, LANDER_H / 2 - 10);
    c.lineTo(-(LANDER_W / 2 + 2), LANDER_H / 2);
    c.lineTo(-6, LANDER_H / 2);
    c.closePath();
    c.moveTo(6, LANDER_H / 2 - 10);
    c.lineTo(LANDER_W / 2 + 2, LANDER_H / 2);
    c.lineTo(6, LANDER_H / 2);
    c.closePath();
    c.fillStyle = ship.legColor;
    c.fill();

    // cylindrical body with a pointed nose
    c.beginPath();
    c.moveTo(0, -LANDER_H / 2);
    c.lineTo(6, -LANDER_H / 2 + 10);
    c.lineTo(6, LANDER_H / 2 - 2);
    c.lineTo(-6, LANDER_H / 2 - 2);
    c.lineTo(-6, -LANDER_H / 2 + 10);
    c.closePath();
    c.fillStyle = ship.hullColor;
    c.fill();
    c.strokeStyle = '#9aa0ab';
    c.lineWidth = 1.5;
    c.stroke();

    c.beginPath();
    c.arc(0, -6, 3.5, 0, Math.PI * 2);
    c.fillStyle = ship.accentColor;
    c.fill();

    drawLegs(c, ship.legColor);
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  function loop(timestamp) {
    if (lastTime === null) lastTime = timestamp;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    update(dt);
    render(timestamp);

    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    if (e.code === 'KeyR' && (state === STATE.PLAYING || state === STATE.PAUSED || state === STATE.LANDED || state === STATE.CRASHED || state === STATE.CRASH_ANIM)) {
      startLevel(level);
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyP' && (state === STATE.PLAYING || state === STATE.PAUSED)) {
      togglePause();
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' && state === STATE.PLAYING && !e.repeat) {
      lander.engineOn = !lander.engineOn;
      e.preventDefault();
      return;
    }
    if (state === STATE.PLAYING && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  function togglePause() {
    if (state === STATE.PLAYING) {
      state = STATE.PAUSED;
      pauseOverlay.classList.remove('hidden');
    } else if (state === STATE.PAUSED) {
      state = STATE.PLAYING;
      pauseOverlay.classList.add('hidden');
      lastTime = null;
    }
  }

  // ---------------------------------------------------------------------
  // Flow control
  // ---------------------------------------------------------------------
  function startLevel(lvl) {
    level = lvl;
    keys = {};
    menuOverlay.classList.add('hidden');
    endOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
    resetLander();
    updateHud();
    state = STATE.PLAYING;
    lastTime = null;
  }

  document.querySelectorAll('.level-btn').forEach((btn) => {
    btn.addEventListener('click', () => startLevel(parseInt(btn.dataset.level, 10)));
  });

  retryBtn.addEventListener('click', () => startLevel(level));
  menuBtn.addEventListener('click', () => {
    state = STATE.MENU;
    endOverlay.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
  });

  // ---------------------------------------------------------------------
  // Customizer
  // ---------------------------------------------------------------------
  function openCustomizer() {
    renderCustomizerOptions();
    toggleCraters.checked = settings.craters;
    togglePlanets.checked = settings.planets;
    toggleShooting.checked = settings.shootingStars;
    toggleNebula.checked = settings.nebula;
    toggleAsteroids.checked = settings.asteroids;
    menuOverlay.classList.add('hidden');
    customizerOverlay.classList.remove('hidden');
  }

  function renderCustomizerOptions() {
    shipOptionsEl.innerHTML = SHIP_DESIGNS.map((s) =>
      `<button class="option-btn ${s.id === settings.shipId ? 'selected' : ''}" data-ship="${s.id}">` +
      `<canvas class="ship-preview" width="50" height="50"></canvas><span>${s.name}</span></button>`
    ).join('');
    shipOptionsEl.querySelectorAll('button').forEach((btn) => {
      const design = SHIP_DESIGNS.find((s) => s.id === btn.dataset.ship);
      const pctx = btn.querySelector('canvas').getContext('2d');
      pctx.save();
      pctx.translate(25, 32);
      design.draw(pctx);
      pctx.restore();
      btn.addEventListener('click', () => {
        settings.shipId = design.id;
        activeShip = design;
        saveSettings();
        renderCustomizerOptions();
      });
    });

    thrustOptionsEl.innerHTML = THRUST_PRESETS.map((p) =>
      `<button class="option-btn ${p.id === settings.thrustId ? 'selected' : ''}" data-thrust="${p.id}">` +
      `<div class="swatch" style="background:radial-gradient(circle, ${p.core}, ${p.mid})"></div><span>${p.name}</span></button>`
    ).join('');
    thrustOptionsEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = THRUST_PRESETS.find((x) => x.id === btn.dataset.thrust);
        settings.thrustId = p.id;
        activeThrust = p;
        saveSettings();
        renderCustomizerOptions();
      });
    });

    mapOptionsEl.innerHTML = MAP_PRESETS.map((m) =>
      `<button class="option-btn ${m.id === settings.mapId ? 'selected' : ''}" data-map="${m.id}">` +
      `<div class="map-swatch" style="background:linear-gradient(180deg, ${m.skyTop}, ${m.terrainFill})"></div><span>${m.name}</span></button>`
    ).join('');
    mapOptionsEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = MAP_PRESETS.find((x) => x.id === btn.dataset.map);
        settings.mapId = m.id;
        activeMap = m;
        saveSettings();
        renderCustomizerOptions();
      });
    });
  }

  customizeBtn.addEventListener('click', openCustomizer);
  customizerBackBtn.addEventListener('click', () => {
    customizerOverlay.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
  });

  [
    [toggleCraters, 'craters'],
    [togglePlanets, 'planets'],
    [toggleShooting, 'shootingStars'],
    [toggleNebula, 'nebula'],
    [toggleAsteroids, 'asteroids'],
  ].forEach(([el, key]) => {
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
    });
  });

  // initial render (menu background)
  stars = makeStars();
  terrain = makeTerrain(CANVAS_W / 2, 300);
  requestAnimationFrame(loop);
})();
