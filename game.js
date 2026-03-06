const WIDTH = 1280;
const HEIGHT = 720;
const TAU = Math.PI * 2;
const LEADERBOARD_KEY = "fortress-of-zorlac.leaderboard.v2";
const LEGACY_LEADERBOARD_KEYS = ["fortress-of-zorlac.leaderboard.v1"];
const OPTIONS_KEY = "fortress-of-zorlac.options.v1";
const MAX_LEADERBOARD = 10;
const MIN_START_LEVEL = 1;
const MAX_START_LEVEL = 12;
const PLAYFIELD = {
  x: 72,
  y: 52,
  w: WIDTH - 144,
  h: HEIGHT - 104,
  bg: "#f2f2ec",
  ink: "#050505",
};

const DIFFICULTIES = {
  cadet: {
    label: "Cadet",
    speed: 0.9,
    fireRate: 0.88,
    score: 1.0,
  },
  pilot: {
    label: "Pilot",
    speed: 1,
    fireRate: 1,
    score: 1.2,
  },
  ace: {
    label: "Ace",
    speed: 1.16,
    fireRate: 1.16,
    score: 1.5,
  },
};

const dom = {
  gamePanel: document.getElementById("gamePanel"),
  canvas: document.getElementById("gameCanvas"),
  overlay: document.getElementById("overlay"),
  overlayEyebrow: document.getElementById("overlayEyebrow"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayText: document.getElementById("overlayText"),
  overlayLeaderboardWrap: document.getElementById("overlayLeaderboardWrap"),
  overlayLeaderboardList: document.getElementById("overlayLeaderboardList"),
  launchForm: document.getElementById("launchForm"),
  levelInput: document.getElementById("levelInput"),
  callsignRow: document.getElementById("callsignRow"),
  callsignInput: document.getElementById("callsignInput"),
  startButton: document.getElementById("startButton"),
  scoreValue: document.getElementById("scoreValue"),
  waveValue: document.getElementById("waveValue"),
  livesValue: document.getElementById("livesValue"),
  multiplierValue: document.getElementById("multiplierValue"),
  statusValue: document.getElementById("statusValue"),
  leaderboardList: document.getElementById("leaderboardList"),
  pauseButton: document.getElementById("pauseButton"),
  soundButton: document.getElementById("soundButton"),
  fullscreenButton: document.getElementById("fullscreenButton"),
  touchButtons: Array.from(document.querySelectorAll(".touch-button")),
};

const ctx = dom.canvas.getContext("2d");
const state = {
  running: false,
  paused: false,
  awaitingRestart: false,
  lastTime: 0,
  time: 0,
  score: 0,
  wave: 1,
  startLevel: 1,
  lives: 5,
  callsign: "ACE",
  difficulty: "pilot",
  riskMultiplier: 1,
  message: "Stand by",
  input: {
    keys: Object.create(null),
    mouse: {
      down: false,
    },
  },
  player: null,
  fortress: null,
  bullets: [],
  enemyBullets: [],
  particles: [],
  flashes: [],
  eventBanner: null,
  screenShake: 0,
  transitionTimer: 0,
  leaderboard: loadLeaderboard(),
  lastLeaderboardResult: null,
  audioEnabled: true,
  audioReady: false,
  musicTimer: 0,
  musicStep: 0,
};

const audio = createAudio();

boot();

function boot() {
  loadOptions();
  resizeCanvas();
  updateOverlayForIntro();
  renderLeaderboard();
  syncHud();
  bindEvents();
  syncFullscreenButton();
  requestAnimationFrame(loop);
}

function bindEvents() {
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("fullscreenchange", syncFullscreenButton);

  window.addEventListener("keydown", (event) => {
    if (event.repeat && event.code === "KeyP") {
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    state.input.keys[event.code] = true;
    if (event.code === "KeyP") {
      togglePause();
    }
  });

  window.addEventListener("keyup", (event) => {
    state.input.keys[event.code] = false;
  });

  dom.canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    state.input.mouse.down = true;
    wakeAudio();
  });

  dom.canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") {
      return;
    }
    state.input.mouse.down = true;
    wakeAudio();
  });

  dom.canvas.addEventListener("pointerup", () => {
    state.input.mouse.down = false;
  });

  dom.canvas.addEventListener("pointercancel", () => {
    state.input.mouse.down = false;
  });

  window.addEventListener("mouseup", () => {
    state.input.mouse.down = false;
  });

  window.addEventListener("pointerup", () => {
    state.input.mouse.down = false;
  });

  window.addEventListener("pointercancel", () => {
    state.input.mouse.down = false;
  });

  dom.launchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startGame();
  });

  dom.pauseButton.addEventListener("click", () => {
    togglePause();
  });

  dom.soundButton.addEventListener("click", () => {
    state.audioEnabled = !state.audioEnabled;
    saveOptions();
    dom.soundButton.textContent = state.audioEnabled ? "Sound: On" : "Sound: Off";
    dom.soundButton.setAttribute("aria-pressed", String(state.audioEnabled));
    if (state.audioEnabled) {
      wakeAudio();
      playMusicPulse(true);
    }
  });

  dom.fullscreenButton.addEventListener("click", () => {
    toggleFullscreen();
  });

  for (const button of dom.touchButtons) {
    const key = button.dataset.key;
    const press = (pressed) => {
      button.classList.toggle("is-active", pressed);
      if (key === "Space") {
        state.input.keys.Space = pressed;
        state.input.mouse.down = pressed;
      } else {
        state.input.keys[key] = pressed;
      }
      wakeAudio();
    };

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      press(true);
    });
    button.addEventListener("pointerup", () => press(false));
    button.addEventListener("pointercancel", () => press(false));
    button.addEventListener("pointerleave", () => press(false));
  }
}

function loop(timestamp) {
  if (!state.lastTime) {
    state.lastTime = timestamp;
  }
  const dt = Math.min(0.033, (timestamp - state.lastTime) / 1000);
  state.lastTime = timestamp;

  if (state.running && !state.paused) {
    update(dt);
  }
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  state.time += dt;
  state.screenShake = Math.max(0, state.screenShake - dt * 4);
  updateFlashes(dt);
  updateEventBanner(dt);
  updateParticles(dt);

  if (state.transitionTimer > 0) {
    state.transitionTimer -= dt;
    if (state.transitionTimer <= 0) {
      setupWave();
    }
    syncHud();
    return;
  }

  if (!state.player || !state.fortress) {
    return;
  }

  updatePlayer(dt);
  updateBullets(dt);
  updateEnemyBullets(dt);
  updateFortress(dt);
  spawnMusic(dt);
  syncHud();
}

function updatePlayer(dt) {
  const player = state.player;
  if (!player.alive) {
    player.respawn -= dt;
    if (player.respawn <= 0) {
      respawnPlayer();
    }
    return;
  }

  const left = state.input.keys.KeyA || state.input.keys.ArrowLeft;
  const right = state.input.keys.KeyD || state.input.keys.ArrowRight;
  const up = state.input.keys.KeyW || state.input.keys.ArrowUp;
  const down = state.input.keys.KeyS || state.input.keys.ArrowDown;
  const moveX = (right ? 1 : 0) - (left ? 1 : 0);
  const moveY = (down ? 1 : 0) - (up ? 1 : 0);
  const moveLength = Math.hypot(moveX, moveY) || 1;

  player.x += (moveX / moveLength) * player.speed * dt;
  player.y += (moveY / moveLength) * player.speed * dt;

  const maxX = state.fortress.gunLineX - 94;
  const verticalBounds = getPlayerVerticalBounds(state.fortress, player);
  player.x = clamp(player.x, PLAYFIELD.x + 90, maxX);
  player.y = clamp(player.y, verticalBounds.min, verticalBounds.max);

  player.invulnerable = Math.max(0, player.invulnerable - dt);
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  state.riskMultiplier = shotMultiplierForX(player.x);

  const firing = state.input.keys.Space || state.input.mouse.down;
  if (firing && player.fireCooldown <= 0) {
    firePlayerShot();
  }
}

function getPlayerVerticalBounds(fortress, player) {
  const playfieldMin = PLAYFIELD.y + 70;
  const playfieldMax = PLAYFIELD.y + PLAYFIELD.h - 70;
  if (!fortress || !fortress.guns.length) {
    return { min: playfieldMin, max: playfieldMax };
  }

  const topGunY = fortress.guns[0].y;
  const bottomGunY = fortress.guns[fortress.guns.length - 1].y;
  const cannonMargin = Math.max(18, player.radius - 6);

  return {
    min: clamp(topGunY - cannonMargin, playfieldMin, playfieldMax),
    max: clamp(bottomGunY + cannonMargin, playfieldMin, playfieldMax),
  };
}

function updateBullets(dt) {
  const next = [];
  for (const bullet of state.bullets) {
    let alive = true;
    const steps = Math.max(1, Math.ceil((bullet.speed * dt) / 12));
    const stepDt = dt / steps;
    for (let index = 0; index < steps && alive; index += 1) {
      bullet.x += bullet.vx * stepDt;
      bullet.y += bullet.vy * stepDt;
      if (!pointInRect(bullet, PLAYFIELD)) {
        alive = false;
        break;
      }
      alive = resolvePlayerBulletHit(bullet);
    }
    if (alive) {
      next.push(bullet);
    }
  }
  state.bullets = next;
}

function updateEnemyBullets(dt) {
  const player = state.player;
  const next = [];
  for (const bullet of state.enemyBullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;

    if (bullet.life <= 0 || !pointInRect(bullet, inflateRect(PLAYFIELD, 30))) {
      continue;
    }

    if (player.alive && player.invulnerable <= 0 && distance(bullet, player) < bullet.radius + player.radius) {
      destroyPlayer("A gun port found the range.");
      aliveFlash("enemy");
      continue;
    }

    next.push(bullet);
  }
  state.enemyBullets = next;
}

function updateFortress(dt) {
  const fortress = state.fortress;
  const difficulty = DIFFICULTIES[state.difficulty];
  const waveFactor = 1 + (state.wave - 1) * 0.1;

  updateFortressDrift(fortress);

  for (const wall of fortress.walls) {
    wall.phase = normalizeUnit(wall.phase + wall.speed * difficulty.speed * dt * waveFactor);
  }

  fortress.fireWarmup = Math.max(0, fortress.fireWarmup - dt);
  if (fortress.fireWarmup <= 0) {
    for (const gun of fortress.guns) {
      gun.cooldown -= dt;
      if (state.player.alive && gun.cooldown <= 0) {
        fireEnemyShot(gun);
        const base = Math.max(1.5, 3.65 - state.wave * 0.08);
        gun.cooldown = randomRange(base, base + 1.15) / difficulty.fireRate;
      }
    }
  }

  if (state.eventBanner) {
    return;
  }

  if (fortress.fireWarmup > 0) {
    state.message = state.wave === state.startLevel ? "Fortress waking" : "Guns reloading";
  } else if (state.player.x > fortress.gunLineX - 150) {
    state.message = "Point-blank run";
  } else if (state.player.x > fortress.gunLineX - 260) {
    state.message = "Press the gap";
  } else {
    state.message = "Wait for alignment";
  }
}

function updateFortressDrift(fortress) {
  const drift = fortress.drift;
  const nextOffset = Math.round(Math.sin(state.time * drift.speed + drift.phase) * drift.amplitude);
  const deltaY = nextOffset - drift.offsetY;
  if (!deltaY) {
    return;
  }
  drift.offsetY = nextOffset;
  shiftFortressBy(fortress, deltaY);
}

function shiftFortressBy(fortress, deltaY) {
  fortress.frame.y += deltaY;
  fortress.chamber.y += deltaY;
  fortress.monsterBaseHitbox.y += deltaY;

  for (const wall of fortress.walls) {
    wall.rect.y += deltaY;
  }

  for (const gun of fortress.guns) {
    gun.y += deltaY;
    gun.hitbox.y += deltaY;
  }
}

function firePlayerShot() {
  const player = state.player;
  const scoreValue = scoreForShot(player.x);
  state.bullets.push({
    x: player.x + 42,
    y: player.y,
    vx: 780,
    vy: 0,
    speed: 780,
    radius: 4,
    scoreValue,
  });
  player.fireCooldown = 0.18;
  createBurst(player.x + 34, player.y, 5, "#101010", 80, 0.16);
  playSound("shoot");
}

function fireEnemyShot(gun) {
  const speed = 210 + state.wave * 8;
  state.enemyBullets.push({
    x: gun.x - 10,
    y: gun.y,
    vx: -speed,
    vy: 0,
    speed,
    radius: 7,
    life: 7,
  });
  createBurst(gun.x, gun.y, 5, "#303030", 40, 0.16);
  playSound("enemyFire");
}

function resolvePlayerBulletHit(bullet) {
  const fortress = state.fortress;

  for (const gun of fortress.guns) {
    if (pointInRect(bullet, inflateRect(gun.hitbox, 4))) {
      createBurst(bullet.x, bullet.y, 8, "#303030", 110, 0.25);
      playSound("ricochet");
      return false;
    }
  }

  for (const wall of fortress.walls) {
    const hitIndex = findWallHit(wall, bullet.x, bullet.y);
    if (hitIndex !== -1) {
      wall.slots[hitIndex] = false;
      state.score += bullet.scoreValue;
      createBurst(bullet.x, bullet.y, 10, "#101010", 120, 0.28);
      state.screenShake = Math.min(0.55, state.screenShake + 0.05);
      playSound("wallHit");
      return false;
    }
  }

  if (pointInRect(bullet, getMonsterRect())) {
    clearWave(bullet.scoreValue * 50);
    return false;
  }

  return true;
}

function clearWave(bonus) {
  const totalBonus = Math.round(bonus * levelScoreMultiplier());
  state.score += totalBonus;
  state.wave += 1;
  state.transitionTimer = 2.2;
  state.bullets.length = 0;
  state.enemyBullets.length = 0;
  const monsterRect = getMonsterRect();
  const blastX = monsterRect.x + monsterRect.w * 0.5;
  const blastY = monsterRect.y + monsterRect.h * 0.5;
  triggerEvent("zorlac", "ZORLAC HIT", `BONUS +${totalBonus}`);
  createBurst(blastX, blastY, 160, "#ff8e53", 280, 1.1);
  createBurst(blastX, blastY, 110, "#050505", 240, 0.95);
  createBurst(blastX, blastY, 70, "#f7f2d8", 180, 0.75);
  aliveFlash("success", 0.34);
  aliveFlash("impact", 0.18);
  state.screenShake = 1.65;
  playSound("coreHit");
}

function destroyPlayer(reason) {
  const player = state.player;
  if (!player.alive) {
    return;
  }
  player.alive = false;
  player.respawn = 1.5;
  state.lives -= 1;
  state.bullets.length = 0;
  triggerEvent("ship", "HERO SHIP DESTROYED", `${Math.max(0, state.lives)} SHIPS REMAIN`);
  createBurst(player.x, player.y, 70, "#050505", 240, 0.8);
  createBurst(player.x, player.y, 52, "#ff8e53", 200, 0.68);
  createBurst(player.x, player.y, 34, "#f7f2d8", 140, 0.42);
  aliveFlash("explode", 0.28);
  aliveFlash("impact", 0.14);
  playSound("playerHit");
  state.screenShake = 1.35;

  if (state.lives <= 0) {
    finishGame();
  }
}

function respawnPlayer() {
  if (state.lives <= 0) {
    return;
  }
  state.player = createPlayer();
  state.message = "Ship restored";
}

function createPlayer() {
  return {
    x: PLAYFIELD.x + 170,
    y: PLAYFIELD.y + PLAYFIELD.h * 0.5,
    width: 74,
    height: 58,
    radius: 30,
    speed: 360,
    invulnerable: 1.3,
    fireCooldown: 0,
    alive: true,
    respawn: 0,
  };
}

function createFortress() {
  const waveFactor = 1 + (state.wave - 1) * 0.1;
  const frame = {
    x: PLAYFIELD.x + PLAYFIELD.w - 320,
    y: PLAYFIELD.y + 70,
    w: 240,
    h: 470,
  };
  const chamber = {
    x: frame.x + 78,
    y: frame.y + 70,
    w: frame.w - 156,
    h: frame.h - 140,
  };

  return {
    frame,
    chamber,
    gunLineX: frame.x - 42,
    fireWarmup: state.wave === state.startLevel ? 4.6 : 1.4,
    drift: {
      amplitude: Math.min(14, 6 + state.wave * 0.7),
      speed: 0.72 + state.wave * 0.035,
      phase: Math.random() * TAU,
      offsetY: 0,
    },
    walls: buildFortressWalls(frame, chamber, waveFactor),
    guns: buildGuns(frame),
    monsterBaseHitbox: {
      x: chamber.x + chamber.w * 0.5 - 24,
      y: chamber.y + chamber.h * 0.5 - 48,
      w: 48,
      h: 96,
    },
  };
}

function buildFortressWalls(frame, chamber, waveFactor) {
  return [
    createWall(
      { x: frame.x + 2, y: frame.y + 2, w: frame.w - 4, h: frame.h - 4 },
      140,
      0.036 + waveFactor * 0.005,
      18,
      "#050505",
      "solid",
      [
        { offset: 10, units: 4 },
        { offset: 34, units: 5 },
        { offset: 63, units: 4 },
        { offset: 91, units: 5 },
        { offset: 118, units: 4 },
      ],
      0.03
    ),
    createWall(
      { x: frame.x + 24, y: frame.y + 24, w: frame.w - 48, h: frame.h - 48 },
      132,
      -0.046 - waveFactor * 0.006,
      16,
      "#050505",
      "dither",
      [
        { offset: 18, units: 4 },
        { offset: 52, units: 5 },
        { offset: 88, units: 4 },
        { offset: 116, units: 3 },
      ],
      0.18
    ),
    createWall(
      { x: chamber.x - 28, y: chamber.y - 28, w: chamber.w + 56, h: chamber.h + 56 },
      104,
      0.03 + waveFactor * 0.004,
      26,
      "#050505",
      "solid",
      [
        { offset: 16, units: 3 },
        { offset: 44, units: 3 },
        { offset: 71, units: 3 },
      ],
      0.08
    ),
  ];
}

function createWall(rect, totalSlots, speed, thickness, color, style, gaps, phase = 0) {
  const perimeter = rect.w * 2 + rect.h * 2;
  const slots = Array.from({ length: totalSlots }, () => true);

  for (const gap of gaps) {
    for (let step = 0; step < gap.units; step += 1) {
      slots[(gap.offset + step) % totalSlots] = false;
    }
  }

  return {
    rect,
    totalSlots,
    slotSize: perimeter / totalSlots,
    speed,
    thickness,
    color,
    style,
    phase,
    slots,
  };
}
function buildGuns(frame) {
  const top = frame.y + 96;
  const gap = (frame.h - 192) / 3;
  return Array.from({ length: 4 }, (_, index) => {
    const y = top + gap * index;
    const x = frame.x - 28;
    return {
      x,
      y,
      cooldown: randomRange(2.6, 4.6),
      hitbox: { x: x - 18, y: y - 18, w: 36, h: 36 },
    };
  });
}
function startGame() {
  const formData = new FormData(dom.launchForm);
  const startLevel = sanitizeStartLevel(formData.get("level"));
  const callsign = sanitizeCallsign(formData.get("callsign") || dom.callsignInput.value || state.callsign);

  state.callsign = callsign;
  state.difficulty = "pilot";
  state.score = 0;
  state.wave = startLevel;
  state.startLevel = startLevel;
  state.lives = 5;
  state.running = true;
  state.paused = false;
  state.awaitingRestart = false;
  state.bullets = [];
  state.enemyBullets = [];
  state.particles = [];
  state.flashes = [];
  state.eventBanner = null;
  state.screenShake = 0;
  state.transitionTimer = 0;
  state.musicTimer = 0;
  state.musicStep = 0;
  state.lastLeaderboardResult = null;
  state.input.mouse.down = false;
  state.player = createPlayer();
  state.fortress = createFortress();
  state.message = "Wait for alignment";
  dom.overlay.hidden = true;
  dom.pauseButton.textContent = "Pause";
  dom.callsignInput.value = callsign;
  dom.levelInput.value = String(startLevel);
  saveOptions();
  enterFullscreen();
  wakeAudio();
  playMusicPulse(true);
  syncHud();
}

function setupWave() {
  state.player = createPlayer();
  state.fortress = createFortress();
  state.eventBanner = null;
  state.message = `Wave ${state.wave}`;
  playSound("waveStart");
}

function finishGame() {
  state.running = false;
  state.awaitingRestart = true;
  maybeStoreLeaderboard();
  updateOverlayForGameOver();
  dom.overlay.hidden = false;
}

function togglePause() {
  if (!state.running) {
    return;
  }
  state.paused = !state.paused;
  dom.pauseButton.textContent = state.paused ? "Resume" : "Pause";
  state.message = state.paused ? "Paused" : state.message;
  if (!state.paused && state.audioEnabled) {
    wakeAudio();
  }
}

function maybeStoreLeaderboard() {
  const entry = {
    id: createRunId(),
    name: state.callsign,
    score: state.score,
    wave: state.wave,
    startLevel: state.startLevel,
    date: new Date().toISOString().slice(0, 10),
    savedAt: new Date().toISOString(),
  };
  const ranked = sortLeaderboard([...state.leaderboard, entry]);
  const rank = ranked.findIndex((candidate) => candidate.id === entry.id) + 1;
  state.lastLeaderboardResult = {
    entry,
    rank,
    qualified: rank > 0 && rank <= MAX_LEADERBOARD,
  };
  state.leaderboard = ranked.slice(0, MAX_LEADERBOARD);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(state.leaderboard));
  renderLeaderboard();
}

function renderLeaderboard() {
  renderLeaderboardInto(dom.leaderboardList, state.leaderboard, MAX_LEADERBOARD);
  renderLeaderboardInto(dom.overlayLeaderboardList, state.leaderboard, 5);
}

function renderLeaderboardInto(element, entries, limit) {
  if (!element) {
    return;
  }
  if (!entries.length) {
    element.innerHTML = '<li><span class="rank">-</span><span class="name">No pilots logged yet</span><span class="score">0</span></li>';
    return;
  }

  element.innerHTML = entries
    .slice(0, limit)
    .map((entry, index) => {
      const latestTag = state.lastLeaderboardResult?.entry?.id === entry.id ? " · Latest" : "";
      return `
        <li>
          <span class="rank">#${index + 1}</span>
          <span>
            <span class="name">${escapeHtml(entry.name)}</span>
            <span class="meta">Start ${entry.startLevel} · Wave ${entry.wave} · ${escapeHtml(entry.date)}${latestTag}</span>
          </span>
          <span class="score">${entry.score.toLocaleString()}</span>
        </li>
      `;
    })
    .join("");
}

function updateOverlayForIntro() {
  dom.overlay.hidden = false;
  dom.overlayEyebrow.textContent = "Choose your start";
  dom.overlayTitle.textContent = "Fortress of Zorlac";
  dom.overlayText.textContent = "Pick the level to begin on. Higher starting levels score more from the first shot.";
  dom.callsignRow.hidden = true;
  dom.overlayLeaderboardWrap.hidden = true;
  dom.startButton.textContent = "Start Assault";
  dom.levelInput.value = String(state.startLevel);
}

function updateOverlayForGameOver() {
  const result = state.lastLeaderboardResult;
  const leaderboardLine = result
    ? result.qualified
      ? `Leaderboard updated at #${result.rank} as ${state.callsign}.`
      : `Score stored for this run, but it did not reach the top ${MAX_LEADERBOARD}.`
    : `Leaderboard status unavailable for this run.`;

  dom.overlayEyebrow.textContent = "Run complete";
  dom.overlayTitle.textContent = `Score ${state.score.toLocaleString()}`;
  dom.overlayText.textContent = `Reached wave ${state.wave} from start level ${state.startLevel}. ${leaderboardLine} Change the name for the next run if needed.`;
  dom.callsignRow.hidden = false;
  dom.overlayLeaderboardWrap.hidden = false;
  dom.startButton.textContent = "Relaunch";
  dom.callsignInput.value = state.callsign;
  renderLeaderboard();
}

function render() {
  ctx.save();
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  const shakeX = (Math.random() - 0.5) * 12 * state.screenShake;
  const shakeY = (Math.random() - 0.5) * 12 * state.screenShake;
  ctx.translate(shakeX, shakeY);

  drawBackground();
  if (state.fortress) {
    drawFortress();
  }
  drawBullets();
  drawParticles();
  if (state.player) {
    drawPlayer();
  }
  drawEffects();
  drawEventBanner();

  ctx.restore();
}

function drawBackground() {
  ctx.fillStyle = "#02050d";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = PLAYFIELD.bg;
  ctx.fillRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.w, PLAYFIELD.h);

  ctx.strokeStyle = PLAYFIELD.ink;
  ctx.lineWidth = 6;
  ctx.strokeRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.w, PLAYFIELD.h);

  ctx.fillStyle = PLAYFIELD.ink;
  ctx.font = "28px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`SCORE: ${state.score}`, WIDTH * 0.5, PLAYFIELD.y + 20);
  ctx.textAlign = "left";
}

function drawFortress() {
  const fortress = state.fortress;
  const frame = fortress.frame;
  const chamber = fortress.chamber;

  ctx.fillStyle = "#d7d7d1";
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);

  for (const wall of fortress.walls) {
    drawWall(wall);
  }

  ctx.fillStyle = PLAYFIELD.bg;
  ctx.fillRect(chamber.x, chamber.y, chamber.w, chamber.h);
  ctx.strokeStyle = PLAYFIELD.ink;
  ctx.lineWidth = 4;
  ctx.strokeRect(chamber.x, chamber.y, chamber.w, chamber.h);

  drawMonster(getMonsterRect());
  for (const gun of fortress.guns) {
    drawGun(gun);
  }
}

function drawWall(wall) {
  for (let slotIndex = 0; slotIndex < wall.slots.length; slotIndex += 1) {
    if (!wall.slots[slotIndex]) {
      continue;
    }
    const rect = wallSegmentRect(wall, slotIndex);
    if (wall.style === "dither") {
      drawDitherRect(rect, wall.color);
    } else {
      ctx.fillStyle = wall.color;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }
}

function drawDitherRect(rect, color) {
  ctx.fillStyle = PLAYFIELD.bg;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = color;
  for (let y = rect.y; y < rect.y + rect.h; y += 4) {
    const shift = Math.floor((y - rect.y) / 4) % 2 === 0 ? 0 : 2;
    for (let x = rect.x + shift; x < rect.x + rect.w; x += 4) {
      ctx.fillRect(x, y, 2, 2);
    }
  }
}
function getMonsterRect() {
  const base = state.fortress.monsterBaseHitbox;
  const waveFactor = 1 + (state.wave - 1) * 0.05;
  const xOffset = Math.round(Math.sin(state.time * 1.35 * waveFactor) * 2);
  const yOffset = Math.round(Math.sin(state.time * 2.1 * waveFactor) * 9 + Math.sin(state.time * 5.4 * waveFactor) * 3);
  return {
    x: base.x + xOffset,
    y: base.y + yOffset,
    w: base.w,
    h: base.h,
  };
}

function drawMonster(hitbox) {
  const armSwing = Math.sign(Math.sin(state.time * 2.1)) * 2;
  const legSwing = Math.sign(Math.cos(state.time * 2.1)) * 2;
  const x = Math.round(hitbox.x + 4);
  const y = Math.round(hitbox.y + 2);

  ctx.fillStyle = PLAYFIELD.ink;
  ctx.fillRect(x + 8, y, 24, 12);
  ctx.fillRect(x + 18, y + 12, 4, 10);
  ctx.fillRect(x + 6, y + 22, 28, 6);
  ctx.fillRect(x + 18, y + 28, 4, 26);
  ctx.fillRect(x + 8, y + 34 + armSwing, 8, 4);
  ctx.fillRect(x + 24, y + 34 - armSwing, 8, 4);
  ctx.fillRect(x + 8, y + 54, 8, 4);
  ctx.fillRect(x + 24, y + 54, 8, 4);
  ctx.fillRect(x + 6 - legSwing, y + 58, 4, 18);
  ctx.fillRect(x + 30 + legSwing, y + 58, 4, 18);
  ctx.fillRect(x + 2 - legSwing, y + 74, 10, 4);
  ctx.fillRect(x + 28 + legSwing, y + 74, 10, 4);

  ctx.fillStyle = PLAYFIELD.bg;
  ctx.fillRect(x + 12, y + 4, 4, 4);
  ctx.fillRect(x + 24, y + 4, 4, 4);
}

function drawGun(gun) {
  const x = Math.round(gun.x - 14);
  const y = Math.round(gun.y - 14);

  ctx.fillStyle = PLAYFIELD.ink;
  ctx.fillRect(x + 10, y, 8, 28);
  ctx.fillRect(x, y + 4, 18, 6);
  ctx.fillRect(x, y + 18, 18, 6);
  ctx.fillRect(x + 18, y + 11, 8, 6);
}

function drawPlayer() {
  const player = state.player;
  if (!player.alive) {
    return;
  }
  const blink = player.invulnerable > 0 && Math.floor(state.time * 12) % 2 === 0;
  if (blink) {
    return;
  }

  const x = Math.round(player.x - player.width * 0.5);
  const y = Math.round(player.y - player.height * 0.5);

  ctx.fillStyle = PLAYFIELD.ink;
  ctx.fillRect(x + 8, y, 50, 10);
  ctx.fillRect(x, y + 10, 16, 38);
  ctx.fillRect(x + 50, y + 10, 16, 38);
  ctx.fillRect(x + 8, y + 48, 50, 10);
  ctx.fillRect(x + 22, y + 16, 22, 26);
  ctx.fillRect(x + 58, y + 22, 10, 14);

  ctx.fillStyle = PLAYFIELD.bg;
  ctx.fillRect(x + 16, y + 4, 10, 4);
  ctx.fillRect(x + 38, y + 4, 10, 4);
  ctx.fillRect(x + 16, y + 50, 10, 4);
  ctx.fillRect(x + 38, y + 50, 10, 4);
  ctx.fillRect(x + 26, y + 20, 14, 16);

  ctx.fillStyle = PLAYFIELD.ink;
  ctx.fillRect(x + 30, y + 23, 6, 10);
}

function drawBullets() {
  for (const bullet of state.bullets) {
    ctx.fillStyle = PLAYFIELD.ink;
    ctx.fillRect(Math.round(bullet.x - 3), Math.round(bullet.y - 3), 6, 6);
  }

  for (const bullet of state.enemyBullets) {
    ctx.fillStyle = PLAYFIELD.ink;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, TAU);
    ctx.fill();
    ctx.fillStyle = PLAYFIELD.bg;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, Math.max(1, bullet.radius - 3), 0, TAU);
    ctx.fill();
  }
}

function drawParticles() {
  for (const particle of state.particles) {
    const alpha = particle.life / particle.maxLife;
    ctx.fillStyle = hexToRgba(particle.color, alpha);
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
}

function drawEffects() {
  for (const flash of state.flashes) {
    ctx.fillStyle = flash.color.replace("ALPHA", (flash.life / flash.maxLife).toFixed(3));
    ctx.fillRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.w, PLAYFIELD.h);
  }
}

function drawEventBanner() {
  if (!state.eventBanner) {
    return;
  }

  const banner = state.eventBanner;
  const fade = clamp(banner.life / banner.maxLife, 0, 1);
  const themes = {
    zorlac: {
      bg: `rgba(255, 142, 83, ${0.88 * fade})`,
      fg: "#050505",
      border: `rgba(247, 242, 216, ${fade})`,
    },
    ship: {
      bg: `rgba(5, 5, 5, ${0.9 * fade})`,
      fg: "#f7f2d8",
      border: `rgba(255, 142, 83, ${fade})`,
    },
  };
  const theme = themes[banner.kind] || themes.ship;
  const width = 420;
  const height = 88;
  const x = PLAYFIELD.x + PLAYFIELD.w * 0.5 - width * 0.5;
  const y = PLAYFIELD.y + 40;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, width, height);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.fg;
  ctx.font = "bold 32px 'Courier New', monospace";
  ctx.fillText(banner.text, x + width * 0.5, y + 30);
  ctx.font = "20px 'Courier New', monospace";
  ctx.fillText(banner.detail, x + width * 0.5, y + 62);
  ctx.textAlign = "left";
}

function syncHud() {
  dom.scoreValue.textContent = state.score.toLocaleString();
  dom.waveValue.textContent = String(state.wave);
  dom.livesValue.textContent = String(Math.max(0, state.lives));
  dom.multiplierValue.textContent = `x${state.riskMultiplier.toFixed(2)}`;
  dom.statusValue.textContent = state.message;
}

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  dom.canvas.width = WIDTH * ratio;
  dom.canvas.height = HEIGHT * ratio;
  dom.canvas.style.width = "100%";
  dom.canvas.style.height = "auto";
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function updateParticles(dt) {
  state.particles = state.particles.filter((particle) => {
    particle.life -= dt;
    if (particle.life <= 0) {
      return false;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.985;
    particle.vy *= 0.985;
    return true;
  });
}

function updateFlashes(dt) {
  state.flashes = state.flashes.filter((flash) => {
    flash.life -= dt;
    return flash.life > 0;
  });
}

function updateEventBanner(dt) {
  if (!state.eventBanner) {
    return;
  }
  state.eventBanner.life -= dt;
  if (state.eventBanner.life <= 0) {
    state.eventBanner = null;
  }
}

function triggerEvent(kind, text, detail, life = 1.35) {
  state.eventBanner = {
    kind,
    text,
    detail,
    life,
    maxLife: life,
  };
  state.message = text;
}

function createBurst(x, y, amount, color, speed, life) {
  for (let index = 0; index < amount; index += 1) {
    const angle = Math.random() * TAU;
    const magnitude = speed * (0.2 + Math.random() * 0.8);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * magnitude,
      vy: Math.sin(angle) * magnitude,
      life: life * (0.6 + Math.random() * 0.6),
      maxLife: life,
      size: randomRange(2, 4),
      color,
    });
  }
}

function aliveFlash(type, life = 0.18) {
  const palettes = {
    success: "rgba(255, 142, 83, ALPHA)",
    impact: "rgba(247, 242, 216, ALPHA)",
    explode: "rgba(5, 5, 5, ALPHA)",
    enemy: "rgba(5, 5, 5, ALPHA)",
  };
  state.flashes.push({
    color: palettes[type] || "rgba(255, 255, 255, ALPHA)",
    life,
    maxLife: life,
  });
}

function findWallHit(wall, x, y) {
  for (let slotIndex = 0; slotIndex < wall.slots.length; slotIndex += 1) {
    if (!wall.slots[slotIndex]) {
      continue;
    }
    if (pointInRect({ x, y }, inflateRect(wallSegmentRect(wall, slotIndex), 2))) {
      return slotIndex;
    }
  }
  return -1;
}

function wallSegmentRect(wall, slotIndex) {
  const rect = wall.rect;
  const perimeter = rect.w * 2 + rect.h * 2;
  let distanceOnPath = normalizeUnit(wall.phase + slotIndex / wall.totalSlots) * perimeter;
  const long = Math.max(8, wall.slotSize + 2);
  const thick = wall.thickness;

  if (distanceOnPath < rect.w) {
    return snapRect({
      x: rect.x + distanceOnPath - long * 0.5,
      y: rect.y - thick * 0.5,
      w: long,
      h: thick,
    });
  }
  distanceOnPath -= rect.w;

  if (distanceOnPath < rect.h) {
    return snapRect({
      x: rect.x + rect.w - thick * 0.5,
      y: rect.y + distanceOnPath - long * 0.5,
      w: thick,
      h: long,
    });
  }
  distanceOnPath -= rect.h;

  if (distanceOnPath < rect.w) {
    return snapRect({
      x: rect.x + rect.w - distanceOnPath - long * 0.5,
      y: rect.y + rect.h - thick * 0.5,
      w: long,
      h: thick,
    });
  }
  distanceOnPath -= rect.w;

  return snapRect({
    x: rect.x - thick * 0.5,
    y: rect.y + rect.h - distanceOnPath - long * 0.5,
    w: thick,
    h: long,
  });
}
function scoreForShot(x) {
  return Math.round(4 * DIFFICULTIES[state.difficulty].score * shotMultiplierForX(x) * levelScoreMultiplier());
}

function levelScoreMultiplier() {
  return 1 + (state.startLevel - 1) * 0.12;
}

function shotMultiplierForX(x) {
  const minX = PLAYFIELD.x + 90;
  const maxX = state.fortress ? state.fortress.gunLineX - 120 : PLAYFIELD.x + PLAYFIELD.w - 180;
  const progress = clamp((x - minX) / Math.max(1, maxX - minX), 0, 1);
  return 1 + progress * 4;
}

function sanitizeStartLevel(value) {
  const numeric = Number.parseInt(String(value || "1"), 10);
  return clamp(Number.isFinite(numeric) ? numeric : 1, MIN_START_LEVEL, MAX_START_LEVEL);
}

function sanitizeCallsign(value) {
  const text = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return text || "ACE";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function saveOptions() {
  localStorage.setItem(
    OPTIONS_KEY,
    JSON.stringify({
      callsign: state.callsign,
      startLevel: state.startLevel,
      audioEnabled: state.audioEnabled,
    })
  );
}

function loadOptions() {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (!raw) {
      dom.levelInput.value = String(state.startLevel);
      dom.callsignInput.value = state.callsign;
      dom.soundButton.textContent = "Sound: On";
      return;
    }
    const data = JSON.parse(raw);
    state.callsign = sanitizeCallsign(data.callsign || "ACE");
    state.startLevel = sanitizeStartLevel(data.startLevel || 1);
    state.difficulty = "pilot";
    state.audioEnabled = data.audioEnabled !== false;
    dom.callsignInput.value = state.callsign;
    dom.levelInput.value = String(state.startLevel);
    dom.soundButton.textContent = state.audioEnabled ? "Sound: On" : "Sound: Off";
    dom.soundButton.setAttribute("aria-pressed", String(state.audioEnabled));
  } catch {
    dom.levelInput.value = String(state.startLevel);
    dom.callsignInput.value = state.callsign;
    dom.soundButton.textContent = "Sound: On";
  }
}

function createRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLeaderboardEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => ({
      id: typeof entry?.id === "string" ? entry.id : createRunId(),
      name: sanitizeCallsign(entry?.name || entry?.callsign || "ACE"),
      score: Math.max(0, Math.round(Number(entry?.score) || 0)),
      wave: Math.max(1, Math.round(Number(entry?.wave) || 1)),
      startLevel: sanitizeStartLevel(entry?.startLevel || 1),
      date:
        typeof entry?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
          ? entry.date
          : new Date().toISOString().slice(0, 10),
      savedAt:
        typeof entry?.savedAt === "string"
          ? entry.savedAt
          : typeof entry?.date === "string"
            ? `${entry.date}T00:00:00.000Z`
            : new Date().toISOString(),
    }));
}

function sortLeaderboard(entries) {
  return entries.slice().sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return String(right.savedAt || "").localeCompare(String(left.savedAt || ""));
  });
}

function loadLeaderboard() {
  try {
    const currentRaw = localStorage.getItem(LEADERBOARD_KEY);
    if (currentRaw) {
      return sortLeaderboard(normalizeLeaderboardEntries(JSON.parse(currentRaw))).slice(0, MAX_LEADERBOARD);
    }

    for (const legacyKey of LEGACY_LEADERBOARD_KEYS) {
      const legacyRaw = localStorage.getItem(legacyKey);
      if (!legacyRaw) {
        continue;
      }
      const migrated = sortLeaderboard(normalizeLeaderboardEntries(JSON.parse(legacyRaw))).slice(0, MAX_LEADERBOARD);
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(migrated));
      localStorage.removeItem(legacyKey);
      return migrated;
    }

    return [];
  } catch {
    return [];
  }
}

function syncFullscreenButton() {
  if (!dom.fullscreenButton) {
    return;
  }
  dom.fullscreenButton.textContent = document.fullscreenElement ? "Windowed" : "Full Screen";
}

async function enterFullscreen() {
  if (!dom.gamePanel || document.fullscreenElement || !dom.gamePanel.requestFullscreen) {
    syncFullscreenButton();
    return;
  }
  try {
    await dom.gamePanel.requestFullscreen();
  } catch {
    syncFullscreenButton();
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await enterFullscreen();
    }
  } catch {
    syncFullscreenButton();
  }
}

function createAudio() {
  const AudioContextRef = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextRef) {
    return null;
  }
  const context = new AudioContextRef();
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -26;
  compressor.knee.value = 18;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.22;
  master.gain.value = 0.18;
  master.connect(compressor);
  compressor.connect(context.destination);
  return { context, master };
}

function wakeAudio() {
  if (!state.audioEnabled || !audio) {
    return;
  }
  if (audio.context.state === "suspended") {
    audio.context.resume();
  }
  state.audioReady = true;
}

function playSound(type) {
  if (!state.audioEnabled || !audio || !state.audioReady) {
    return;
  }
  const now = audio.context.currentTime;
  switch (type) {
    case "shoot":
      tone(now, 980, 260, 0.026, "square", 0.042);
      tone(now, 420, 180, 0.05, "triangle", 0.018);
      noise(now, 0.018, 0.012, 1800, 3200);
      break;
    case "wallHit":
      tone(now, 110, 54, 0.11, "sine", 0.03);
      tone(now, 320, 130, 0.055, "square", 0.026);
      noise(now, 0.075, 0.045, 680, 2200);
      break;
    case "ricochet":
      tone(now, 1440, 520, 0.05, "triangle", 0.032);
      tone(now + 0.012, 1880, 760, 0.04, "square", 0.02);
      break;
    case "enemyFire":
      tone(now, 210, 145, 0.12, "sawtooth", 0.04);
      tone(now, 88, 52, 0.16, "sine", 0.026);
      noise(now, 0.02, 0.012, 240, 600);
      break;
    case "playerHit":
      tone(now, 122, 38, 0.34, "sawtooth", 0.06);
      tone(now, 64, 24, 0.42, "sine", 0.05);
      tone(now + 0.03, 420, 96, 0.2, "triangle", 0.028);
      noise(now, 0.34, 0.16, 90, 760);
      break;
    case "coreHit":
      tone(now, 72, 24, 0.48, "sine", 0.075);
      tone(now, 260, 860, 0.13, "triangle", 0.055);
      tone(now + 0.08, 420, 1280, 0.16, "triangle", 0.05);
      tone(now + 0.05, 180, 80, 0.24, "sawtooth", 0.035);
      noise(now, 0.42, 0.18, 150, 2200);
      break;
    case "waveStart":
      tone(now, 220, 330, 0.08, "sine", 0.026);
      tone(now + 0.05, 330, 494, 0.08, "sine", 0.022);
      tone(now, 110, 110, 0.18, "triangle", 0.014);
      break;
    default:
      break;
  }
}

function spawnMusic(dt) {
  if (!state.audioEnabled || !audio || !state.audioReady || state.paused) {
    return;
  }
  state.musicTimer -= dt;
  if (state.musicTimer > 0) {
    return;
  }
  playMusicPulse(false);
  state.musicTimer = Math.max(0.34, 0.78 - state.wave * 0.03);
}

function playMusicPulse(force) {
  if (!audio || !state.audioEnabled || !state.audioReady) {
    return;
  }
  const scale = [98, 131, 147, 175, 196, 220];
  const note = scale[state.musicStep % scale.length] * (1 + (state.wave - 1) * 0.012);
  const when = audio.context.currentTime + (force ? 0.01 : 0);
  tone(when, note, note * 0.58, 0.24, "square", 0.022);
  tone(when, note * 0.5, note * 0.5, 0.28, "sine", 0.012);
  tone(when, note * 2, note * 1.18, 0.1, "triangle", 0.013);
  state.musicStep += 1;
}

function tone(start, from, to, duration, type, volume) {
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audio.master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function noise(start, duration, volume, from, to) {
  const length = Math.ceil(audio.context.sampleRate * duration);
  const buffer = audio.context.createBuffer(1, length, audio.context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / length);
  }
  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const gain = audio.context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  source.start(start);
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function inflateRect(rect, amount) {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    w: rect.w + amount * 2,
    h: rect.h + amount * 2,
  };
}

function snapRect(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.round(rect.h),
  };
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function normalizeUnit(value) {
  let next = value % 1;
  if (next < 0) {
    next += 1;
  }
  return next;
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((char) => char + char).join("")
    : clean;
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}



































