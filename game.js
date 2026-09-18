(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  const CANVAS_W = 900;
  const CANVAS_H = 600;
  const PAD_Y = 520;              // y of the ground/pad surface
  const GRAVITY = 28;             // px/s^2
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

  function makeStars() {
    const arr = [];
    for (let i = 0; i < 140; i++) {
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
  function computeFuelBudget(mass, startAltitude) {
    const aMax = THRUST_FORCE / mass;
    const netDecel = Math.max(aMax - GRAVITY, 1);
    const v0 = Math.sqrt(2 * GRAVITY * startAltitude * netDecel / aMax);
    const tBurn = v0 / netDecel;
    const fuelMin = BURN_RATE * tBurn;
    return fuelMin * 3.2 + 45; // margin factor + flat buffer for maneuvering
  }

  function resetLander() {
    cfg = LEVEL_CONFIG[level];
    const padCenter = CANVAS_W / 2;
    terrain = makeTerrain(padCenter, cfg.padWidth);
    stars = makeStars();
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

    const maxFuel = cfg.fuelLimit ? computeFuelBudget(mass, START_ALT) : Infinity;

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

    let legend = 'Space engine on/off &nbsp; &uarr; throttle up &nbsp; &darr; throttle down';
    if (cfg.angleControl) legend += ' &nbsp; &larr; rotate left &nbsp; &rarr; rotate right';
    legend += ' &nbsp; R restart &nbsp; P pause';
    controlsLegend.innerHTML = legend;
  }

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------
  function update(dt) {
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

    const PIECE_DEFS = [
      { pts: [[0, -17], [8, -2], [-8, -2]], color: '#d8e2f5' },        // nose cone
      { pts: [[-13, -2], [0, -2], [0, 11], [-13, 11]], color: '#c3cfe6' },  // left hull
      { pts: [[0, -2], [13, -2], [13, 11], [0, 11]], color: '#aebbdb' },    // right hull
      { pts: [[-13, 5], [-21, 19], [-9, 13]], color: '#9fb0d6' },       // left leg
      { pts: [[13, 5], [21, 19], [9, 13]], color: '#9fb0d6' },         // right leg
      { pts: [[-5, -8], [5, -8], [4, 2], [-4, 2]], color: '#4d7cff' },  // cockpit window
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
    grad.addColorStop(0, '#05070d');
    grad.addColorStop(1, '#0b1226');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // stars
    ctx.fillStyle = '#cfe0ff';
    for (const s of stars) {
      const twinkle = 0.6 + 0.4 * Math.sin(t / 500 + s.tw);
      ctx.globalAlpha = twinkle;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (terrain) drawTerrain();

    if (state === STATE.CRASH_ANIM || (debris.length && state === STATE.CRASHED)) {
      drawDebris();
      drawSparks();
    } else if (lander) {
      drawLander();
    }

    ctx.restore();
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
      ctx.fillStyle = life > 0.5 ? '#fff2b0' : '#ff9a3d';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawTerrain() {
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    for (const p of terrain.points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(CANVAS_W, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = '#161d33';
    ctx.fill();
    ctx.strokeStyle = '#2c3a63';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(terrain.points[0].x, terrain.points[0].y);
    for (const p of terrain.points) ctx.lineTo(p.x, p.y);
    ctx.stroke();

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

    // flame
    const hasFuel = !cfg.fuelLimit || lander.fuel > 0;
    if (lander.throttle > 4 && hasFuel && lander.engineOn) {
      const flameLen = 10 + (lander.throttle / 100) * 26 * (0.7 + 0.3 * Math.random());
      ctx.beginPath();
      ctx.moveTo(-7, LANDER_H / 2);
      ctx.lineTo(0, LANDER_H / 2 + flameLen);
      ctx.lineTo(7, LANDER_H / 2);
      ctx.closePath();
      const fgrad = ctx.createLinearGradient(0, LANDER_H / 2, 0, LANDER_H / 2 + flameLen);
      fgrad.addColorStop(0, '#fff2b0');
      fgrad.addColorStop(0.5, '#ff9a3d');
      fgrad.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = fgrad;
      ctx.fill();
    }

    // body
    ctx.beginPath();
    ctx.moveTo(0, -LANDER_H / 2);
    ctx.lineTo(LANDER_W / 2, LANDER_H / 2 - 6);
    ctx.lineTo(LANDER_W / 2, LANDER_H / 2);
    ctx.lineTo(-LANDER_W / 2, LANDER_H / 2);
    ctx.lineTo(-LANDER_W / 2, LANDER_H / 2 - 6);
    ctx.closePath();
    ctx.fillStyle = '#d8e2f5';
    ctx.fill();
    ctx.strokeStyle = '#7f93bf';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // window
    ctx.beginPath();
    ctx.arc(0, -4, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#4d7cff';
    ctx.fill();

    // legs
    ctx.strokeStyle = '#9fb0d6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-LANDER_W / 2, LANDER_H / 2 - 6);
    ctx.lineTo(-LANDER_W / 2 - 8, LANDER_H / 2 + 8);
    ctx.moveTo(LANDER_W / 2, LANDER_H / 2 - 6);
    ctx.lineTo(LANDER_W / 2 + 8, LANDER_H / 2 + 8);
    ctx.stroke();

    ctx.restore();
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
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
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

  // initial render (menu background)
  stars = makeStars();
  terrain = makeTerrain(CANVAS_W / 2, 300);
  requestAnimationFrame(loop);
})();
