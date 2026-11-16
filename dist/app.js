"use strict";
(() => {
  // src/math.ts
  var TAU = Math.PI * 2;
  var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  var rand = (lo, hi) => lo + Math.random() * (hi - lo);
  var randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function hash3(x, y, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  var K1 = 1 / 260;
  var K2 = 1 / 310;
  var K3 = 1 / 190;
  var CURRENT_SCALE = 3400;
  function current(x, y, t, out) {
    const a = x * K1 + t * 0.07;
    const b = y * K2 - t * 0.05;
    const c = (x + y) * K3 + t * 0.11;
    out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    return out;
  }

  // src/species.ts
  var SPECIES = [
    {
      name: "sardine",
      cruise: 36,
      maxSpeed: 64,
      minSpeed: 18,
      weight: 3,
      schoolSize: [18, 28],
      spacing: [1.8, 1.1],
      align: 1.6,
      cohesion: 1.6,
      jitter: 40,
      mill: 70,
      verticalDrag: 0.5
    },
    {
      name: "anchovy",
      cruise: 46,
      maxSpeed: 78,
      minSpeed: 22,
      weight: 3,
      schoolSize: [20, 32],
      spacing: [1.5, 1],
      align: 3.2,
      cohesion: 0.45,
      jitter: 30,
      mill: 0,
      verticalDrag: 1.4
    },
    {
      name: "silverside",
      cruise: 40,
      maxSpeed: 70,
      minSpeed: 20,
      weight: 3,
      schoolSize: [12, 20],
      spacing: [2, 1.1],
      align: 2.4,
      cohesion: 1.1,
      jitter: 35,
      mill: 0,
      verticalDrag: 1.6
    },
    {
      name: "mackerel",
      cruise: 32,
      maxSpeed: 60,
      minSpeed: 16,
      weight: 2,
      schoolSize: [5, 9],
      spacing: [2.6, 1.3],
      align: 2,
      cohesion: 0.9,
      jitter: 25,
      mill: 0,
      verticalDrag: 2
    },
    {
      name: "goby",
      cruise: 26,
      maxSpeed: 56,
      minSpeed: 10,
      weight: 1,
      schoolSize: [8, 12],
      spacing: [1.4, 1.1],
      align: 0.35,
      cohesion: 1.4,
      jitter: 110,
      mill: 0,
      verticalDrag: 0.3
    }
  ];
  var TOTAL_WEIGHT = SPECIES.reduce((sum, s) => sum + s.weight, 0);
  function pickSpecies() {
    let r = Math.random() * TOTAL_WEIGHT;
    for (let i = 0; i < SPECIES.length; i++) {
      r -= SPECIES[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  // src/world.ts
  var SHARK_NODES = 20;
  var DEFAULT_SHARKS = [
    { kind: "classic", size: 1 },
    { kind: "classic", size: 0.7 },
    { kind: "classic", size: 0.84 },
    { kind: "classic", size: 0.77 }
  ];
  var FISH_SEPARATION_K = 420;
  var FISH_ALIGN_K = 1.4;
  var FISH_COHESION_K = 1;
  var FISH_FLEE_K = 1100;
  var SPLASH_RADIUS = 240;
  var SPLASH_RECOVERY = 2.2;
  var BLIND_COS = -0.6;
  var World = class {
    /** fishCount overrides the area-based population (the sidebar wants a single small school). */
    constructor(sharkSpecs = DEFAULT_SHARKS, fishCount) {
      this.sharkSpecs = sharkSpecs;
      this.fishCount = fishCount;
    }
    width = 0;
    height = 0;
    time = 0;
    fish = [];
    sharks = [];
    events = [];
    pointer = { x: 0, y: 0, active: false, movedAt: -Infinity };
    recentSplash = null;
    get splashState() {
      return this.recentSplash;
    }
    /** Fish neighbourhood radius; the spatial hash bucket size matches it. */
    perception = 60;
    /** Per-species personal space in px (x, y). */
    sepX = [];
    sepY = [];
    foreignSep = 40;
    bucketCols = 0;
    bucketRows = 0;
    bucketHead = new Int32Array(0);
    bucketCount = new Uint16Array(0);
    bucketNext = new Int32Array(0);
    lastSpawn = 0;
    tmp = { x: 0, y: 0 };
    resize(width, height, cellW, cellH) {
      const first = this.width === 0;
      this.width = width;
      this.height = height;
      this.sepX = SPECIES.map((sp) => sp.spacing[0] * cellW);
      this.sepY = SPECIES.map((sp) => sp.spacing[1] * cellH);
      this.perception = Math.max(cellH * 3, cellW * 5.5);
      this.foreignSep = cellW * 3;
      if (first || this.fish.length === 0) {
        this.seed();
        return;
      }
      for (const f of this.fish) {
        f.x = clamp(f.x, 0, width);
        f.y = clamp(f.y, 0, height);
      }
    }
    seed() {
      const { width: W, height: H } = this;
      const minSide = Math.min(W, H);
      const baseLength = clamp(minSide * 0.44, 170, 430) * 1.2;
      const sharkCount = this.sharkSpecs.length;
      this.sharks = [];
      for (let i = 0; i < sharkCount; i++) {
        const { kind, size } = this.sharkSpecs[i];
        const length = baseLength * size;
        const orbitRadius = minSide * rand(0.28, 0.4);
        const a = i / sharkCount * TAU + rand(-0.4, 0.4);
        const orbitDir = i % 2 === 0 ? 1 : -1;
        const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.9;
        const y = H / 2 + Math.sin(a) * orbitRadius;
        const heading = a + orbitDir * Math.PI / 2;
        const nodes = new Float32Array(SHARK_NODES * 2);
        const seg = length / (SHARK_NODES - 1);
        for (let n = 0; n < SHARK_NODES; n++) {
          nodes[n * 2] = x - Math.cos(heading) * seg * n;
          nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
        }
        this.sharks.push({
          id: i + 1,
          kind,
          length,
          nodes,
          heading,
          speed: 30,
          phase: rand(0, TAU),
          turn: 0,
          hunger: rand(0.25, 0.75),
          wander: 0,
          orbitDir,
          orbitRadius,
          target: null,
          retargetAt: 0,
          depth: size
        });
      }
      this.sharks.sort((a, b) => a.length - b.length);
      const total = this.fishCount ?? clamp(Math.round(W * H / 4400), 85, 340);
      this.fish = [];
      while (this.fish.length < total) {
        const species = pickSpecies();
        const sp = SPECIES[species];
        const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.fish.length);
        const millDir = Math.random() < 0.5 ? 1 : -1;
        const cx = rand(W * 0.06, W * 0.94);
        const cy = rand(H * 0.08, H * 0.92);
        const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
        for (let k = 0; k < size; k++) {
          this.fish.push({
            x: cx + rand(-1, 1) * this.sepX[species] * Math.sqrt(size),
            y: cy + rand(-1, 1) * this.sepY[species] * Math.sqrt(size) * 0.6,
            vx: Math.cos(dir) * sp.cruise,
            vy: Math.sin(dir) * sp.cruise,
            species,
            alarm: 0,
            startledUntil: 0,
            alive: true,
            respawnAt: 0,
            phase: rand(0, TAU),
            turn: 0,
            depth: rand(0.55, 1),
            millDir
          });
        }
      }
      this.bucketNext = new Int32Array(this.fish.length);
    }
    splash(x, y) {
      this.events.push({ kind: "splash", x, y });
      this.recentSplash = { x, y, radius: SPLASH_RADIUS, startedAt: this.time, until: this.time + SPLASH_RECOVERY };
      for (const f of this.fish) {
        if (!f.alive) continue;
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy);
        if (d >= SPLASH_RADIUS) continue;
        const escapeSpeed = 110 + (1 - d / SPLASH_RADIUS) * 125;
        const direction = d > 1e-3 ? Math.atan2(dy, dx) : Math.atan2(f.vy, f.vx) + Math.PI;
        f.vx = Math.cos(direction) * escapeSpeed;
        f.vy = Math.sin(direction) * escapeSpeed;
        f.startledUntil = this.time + 0.85;
        f.alarm = Math.max(f.alarm, 1 - d / SPLASH_RADIUS * 0.65);
      }
    }
    step(dt) {
      this.time += dt;
      this.rebuildHash();
      this.stepFish(dt);
      this.stepSharks(dt);
      this.respawn();
    }
    rebuildHash() {
      const size = this.perception;
      const pad = 2;
      this.bucketCols = Math.ceil(this.width / size) + pad * 2;
      this.bucketRows = Math.ceil(this.height / size) + pad * 2;
      const n = this.bucketCols * this.bucketRows;
      if (this.bucketHead.length !== n) {
        this.bucketHead = new Int32Array(n);
        this.bucketCount = new Uint16Array(n);
      }
      this.bucketHead.fill(-1);
      this.bucketCount.fill(0);
      if (this.bucketNext.length !== this.fish.length) {
        this.bucketNext = new Int32Array(this.fish.length);
      }
      for (let i = 0; i < this.fish.length; i++) {
        const f = this.fish[i];
        if (!f.alive) continue;
        const b = this.bucketOf(f.x, f.y);
        this.bucketNext[i] = this.bucketHead[b];
        this.bucketHead[b] = i;
        this.bucketCount[b]++;
      }
    }
    bucketOf(x, y) {
      const size = this.perception;
      const c = clamp(Math.floor(x / size) + 2, 0, this.bucketCols - 1);
      const r = clamp(Math.floor(y / size) + 2, 0, this.bucketRows - 1);
      return r * this.bucketCols + c;
    }
    stepFish(dt) {
      const { fish, sharks, pointer, width: W, height: H, time } = this;
      const R = this.perception;
      const R2 = R * R;
      const foreignSep = this.foreignSep;
      const size = this.perception;
      const cols = this.bucketCols;
      const rows = this.bucketRows;
      const head = this.bucketHead;
      const next = this.bucketNext;
      const cur = this.tmp;
      const calmDecay = Math.exp(-dt * 0.7);
      const contagion = Math.min(1, dt * 6);
      if (this.recentSplash && time >= this.recentSplash.until) this.recentSplash = null;
      const splash = this.recentSplash;
      const splashStrength = splash ? ((splash.until - time) / SPLASH_RECOVERY) ** 2 : 0;
      const movingPointer = pointer.active && time - pointer.movedAt < 0.35;
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i];
        if (!f.alive) continue;
        const sp = SPECIES[f.species];
        const spread = 1 + 1.8 * f.alarm;
        const sepX = this.sepX[f.species] * spread;
        const sepY = this.sepY[f.species] * spread;
        const speed2 = Math.hypot(f.vx, f.vy) || 1;
        const hx = f.vx / speed2;
        const hy = f.vy / speed2;
        let ax = 0;
        let ay = 0;
        let sx = 0;
        let sy = 0;
        let avx = 0;
        let avy = 0;
        let cx = 0;
        let cy = 0;
        let n = 0;
        let neighbourAlarm = 0;
        const bc = clamp(Math.floor(f.x / size) + 2, 0, cols - 1);
        const br = clamp(Math.floor(f.y / size) + 2, 0, rows - 1);
        for (let r = Math.max(0, br - 1); r <= Math.min(rows - 1, br + 1); r++) {
          for (let c = Math.max(0, bc - 1); c <= Math.min(cols - 1, bc + 1); c++) {
            let j = head[r * cols + c];
            while (j !== -1) {
              if (j !== i) {
                const o = fish[j];
                const dx = o.x - f.x;
                const dy = o.y - f.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < R2 && d2 > 1e-6) {
                  const d = Math.sqrt(d2);
                  if ((dx * hx + dy * hy) / d > BLIND_COS) {
                    const qx = dx / sepX;
                    const qy = dy / sepY;
                    const q2 = qx * qx + qy * qy;
                    if (q2 < 1) {
                      const q = Math.sqrt(q2) || 1e-3;
                      const k = (1 - q) / q;
                      sx -= qx * k;
                      sy -= qy * k;
                    }
                    if (o.species === f.species) {
                      avx += o.vx;
                      avy += o.vy;
                      cx += dx;
                      cy += dy;
                      n++;
                    } else if (d < foreignSep) {
                      const k = (1 - d / foreignSep) / d * 0.6;
                      sx -= dx * k;
                      sy -= dy * k;
                    }
                    if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;
                  }
                }
              }
              j = next[j];
            }
          }
        }
        ax += sx * FISH_SEPARATION_K;
        ay += sy * FISH_SEPARATION_K;
        if (n > 0) {
          const alignK = FISH_ALIGN_K * sp.align;
          const cohesionK = FISH_COHESION_K * sp.cohesion * (1 - 0.8 * f.alarm);
          ax += (avx / n - f.vx) * alignK + cx / n * cohesionK;
          ay += (avy / n - f.vy) * alignK + cy / n * cohesionK;
          if (sp.mill > 0) {
            const cl = Math.hypot(cx, cy) || 1;
            ax += -cy / cl * f.millDir * sp.mill * (1 - f.alarm);
            ay += cx / cl * f.millDir * sp.mill * (1 - f.alarm);
          }
        }
        let fear = 0;
        for (const sh of sharks) {
          const fearR = sh.length * 0.6 + 60;
          let best = Infinity;
          let bx = 0;
          let by = 0;
          for (let k = 0; k <= 12; k += 3) {
            const nx = sh.nodes[k * 2];
            const ny = sh.nodes[k * 2 + 1];
            const d2 = (f.x - nx) ** 2 + (f.y - ny) ** 2;
            if (d2 < best) {
              best = d2;
              bx = nx;
              by = ny;
            }
          }
          const d = Math.sqrt(best);
          if (d >= fearR || d < 1e-3) continue;
          let w = 1 - d / fearR;
          w *= w;
          const awayX = (f.x - bx) / d;
          const awayY = (f.y - by) / d;
          const shx = Math.cos(sh.heading);
          const shy = Math.sin(sh.heading);
          const side = shx * (f.y - sh.nodes[1]) - shy * (f.x - sh.nodes[0]) >= 0 ? 1 : -1;
          ax += (awayX * 0.7 - shy * side * 0.9) * FISH_FLEE_K * w;
          ay += (awayY * 0.7 + shx * side * 0.9) * FISH_FLEE_K * w;
          fear = Math.max(fear, Math.sqrt(w));
        }
        if (splash) {
          const dx = f.x - splash.x;
          const dy = f.y - splash.y;
          const d = Math.hypot(dx, dy);
          if (d < SPLASH_RADIUS && d > 1e-3) {
            const weight = splashStrength * (1 - d / SPLASH_RADIUS) ** 2;
            ax += dx / d * FISH_FLEE_K * weight;
            ay += dy / d * FISH_FLEE_K * weight;
            fear = Math.max(fear, weight);
          }
        }
        if (movingPointer) {
          const pr = 130;
          const dx = f.x - pointer.x;
          const dy = f.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < pr && d > 1e-3) {
            const w = (1 - d / pr) ** 2;
            ax += dx / d * FISH_FLEE_K * w;
            ay += dy / d * FISH_FLEE_K * w;
            fear = Math.max(fear, Math.sqrt(w) * 0.8);
          }
        }
        let alarm = Math.max(f.alarm * calmDecay, fear);
        const relayed = neighbourAlarm * 0.86;
        if (relayed > alarm) alarm += (relayed - alarm) * contagion;
        f.alarm = alarm;
        const m = 36;
        if (f.x < m) ax += (m - f.x) * 7;
        else if (f.x > W - m) ax -= (f.x - (W - m)) * 7;
        if (f.y < m) ay += (m - f.y) * 7;
        else if (f.y > H - m) ay -= (f.y - (H - m)) * 7;
        current(f.x, f.y, time, cur);
        ax += cur.x * 0.5 + (Math.random() - 0.5) * sp.jitter;
        ay += cur.y * 0.5 + (Math.random() - 0.5) * sp.jitter;
        ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);
        const preferred = sp.cruise * (1 + 1.3 * f.alarm);
        ax += (preferred - speed2) * hx * 1.6;
        ay += (preferred - speed2) * hy * 1.6;
        const before = Math.atan2(f.vy, f.vx);
        f.vx += ax * dt;
        f.vy += ay * dt;
        const maxSpeed = sp.maxSpeed * (1 + 1.8 * f.alarm);
        const s = Math.hypot(f.vx, f.vy);
        if (s > maxSpeed) {
          f.vx *= maxSpeed / s;
          f.vy *= maxSpeed / s;
        } else if (s < sp.minSpeed && s > 1e-3) {
          f.vx *= sp.minSpeed / s;
          f.vy *= sp.minSpeed / s;
        }
        f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);
        f.phase += dt * (7 + Math.hypot(f.vx, f.vy) * 0.12);
        f.x = clamp(f.x + f.vx * dt, -60, W + 60);
        f.y = clamp(f.y + f.vy * dt, -60, H + 60);
      }
    }
    stepSharks(dt) {
      const { sharks, width: W, height: H, time } = this;
      const minSide = Math.min(W, H);
      const cxW = W / 2;
      const cyW = H / 2;
      for (const sh of sharks) {
        const L = sh.length;
        const nodes = sh.nodes;
        const hx = nodes[0];
        const hy = nodes[1];
        const gentle = sh.kind === "manta" || sh.kind === "whaleshark" || sh.kind === "sunfish";
        sh.hunger = gentle ? 0 : Math.min(1, sh.hunger + dt * 0.03);
        let dx = Math.cos(sh.heading);
        let dy = Math.sin(sh.heading);
        sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
        dx += Math.cos(sh.heading + sh.wander) * 0.45;
        dy += Math.sin(sh.heading + sh.wander) * 0.45;
        if (time >= sh.retargetAt) {
          sh.target = gentle ? null : this.findPrey(sh);
          sh.retargetAt = time + 0.45;
        }
        const t = sh.target;
        let hunting = false;
        let closing = 0;
        if (t && t.alive && sh.hunger > 0.3) {
          const tx = t.x + t.vx * 0.35 - hx;
          const ty = t.y + t.vy * 0.35 - hy;
          const d = Math.hypot(tx, ty) || 1;
          const w = 1.4 + 2.6 * sh.hunger;
          dx += tx / d * w;
          dy += ty / d * w;
          hunting = true;
          closing = clamp(1 - d / (L * 0.9), 0, 1);
        } else {
          const rx = (hx - cxW) / (W / minSide);
          const ry = hy - cyW;
          const r = Math.hypot(rx, ry) || 1;
          const radius = sh.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));
          const radial = clamp((radius - r) / radius, -1, 1);
          dx += (-ry / r * sh.orbitDir + rx / r * radial * 0.9) * 0.55;
          dy += (rx / r * sh.orbitDir + ry / r * radial * 0.9) * 0.55;
        }
        for (const other of sharks) {
          if (other === sh) continue;
          for (let k = 0; k < SHARK_NODES; k += 4) {
            const ox = hx - other.nodes[k * 2];
            const oy = hy - other.nodes[k * 2 + 1];
            const d = Math.hypot(ox, oy);
            const range = (L + other.length) * 0.45;
            if (d < range && d > 1e-3) {
              const w = (1 - d / range) * 3;
              dx += ox / d * w;
              dy += oy / d * w;
            }
          }
        }
        const ex = (hx - cxW) / (W * 0.3);
        const ey = (hy - cyW) / (H * 0.16);
        const e2 = ex * ex + ey * ey;
        if (e2 < 1) {
          const e = Math.sqrt(e2) || 1e-3;
          const w = (1 - e) * (hunting ? 1 : 2.5);
          dx += ex / e * w;
          dy += ey / e * w;
        }
        const over = Math.max(-hx, hx - W, -hy, hy - H);
        if (over > -L * 0.05) {
          const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
          const toX = cxW - hx;
          const toY = cyW - hy;
          const d = Math.hypot(toX, toY) || 1;
          dx += toX / d * w;
          dy += toY / d * w;
        }
        let splashAvoidance = 0;
        const splash = this.recentSplash;
        if (splash) {
          const mid = Math.floor(SHARK_NODES / 3) * 2;
          const awayX = nodes[mid] - splash.x;
          const awayY = nodes[mid + 1] - splash.y;
          const distance = Math.hypot(awayX, awayY);
          if (distance < splash.radius && distance > 1e-3) {
            splashAvoidance = (1 - distance / splash.radius) * ((splash.until - time) / SPLASH_RECOVERY);
            dx += awayX / distance * splashAvoidance * 9;
            dy += awayY / distance * splashAvoidance * 9;
          }
        }
        const desired = Math.atan2(dy, dx);
        const agility = Math.min(hunting ? 1.7 + closing : 0.8, sh.speed / (L * 0.22)) + splashAvoidance * 1.7;
        const maxTurn = agility * dt;
        const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);
        sh.heading += turned;
        sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);
        const pace = sh.kind === "sunfish" ? 0.63 : gentle ? 0.8 : 1;
        const cruise = (30 + L * 0.04) * pace;
        const targetSpeed = hunting ? cruise * (1.45 + closing * 1.5) : cruise;
        sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * 1.1);
        sh.phase += dt * (2 + sh.speed / 24);
        nodes[0] += Math.cos(sh.heading) * sh.speed * dt;
        nodes[1] += Math.sin(sh.heading) * sh.speed * dt;
        const seg = L / (SHARK_NODES - 1);
        const maxBend = 0.16;
        let prevAngle = sh.heading + Math.PI;
        for (let k = 1; k < SHARK_NODES; k++) {
          const px = nodes[(k - 1) * 2];
          const py = nodes[(k - 1) * 2 + 1];
          let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
          angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
          nodes[k * 2] = px + Math.cos(angle) * seg;
          nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
          prevAngle = angle;
        }
        if (sh.hunger > 0.15) {
          const mouthR = L * 0.05 + 8;
          const mx = nodes[0];
          const my = nodes[1];
          for (const f of this.fish) {
            if (!f.alive) continue;
            if ((f.x - mx) ** 2 + (f.y - my) ** 2 < mouthR * mouthR) {
              f.alive = false;
              f.respawnAt = time + rand(3, 8);
              sh.hunger = Math.max(0, sh.hunger - 0.16);
              this.events.push({ kind: "eat", x: f.x, y: f.y });
            }
          }
        }
      }
    }
    /**
     * Pick prey in the shark's forward cone, preferring close fish in sparse
     * buckets (stragglers) over fish buried in a dense school.
     */
    findPrey(sh) {
      const range = sh.length * 0.9 + 160;
      const hx = sh.nodes[0];
      const hy = sh.nodes[1];
      const fx = Math.cos(sh.heading);
      const fy = Math.sin(sh.heading);
      let best = null;
      let bestScore = Infinity;
      let currentScore = Infinity;
      for (const f of this.fish) {
        if (!f.alive) continue;
        const dx = f.x - hx;
        const dy = f.y - hy;
        const d = Math.hypot(dx, dy);
        if (d > range || d < 1e-3) continue;
        const cos = (dx * fx + dy * fy) / d;
        if (cos < 0.2) continue;
        const crowd = this.bucketCount[this.bucketOf(f.x, f.y)];
        const score = d * (1 + (1 - cos) * 0.8) * (1 + crowd * 0.07);
        if (score < bestScore) {
          bestScore = score;
          best = f;
        }
        if (f === sh.target) currentScore = score;
      }
      if (sh.target && currentScore < bestScore * 1.3) return sh.target;
      return best;
    }
    respawn() {
      const { time, width: W, height: H } = this;
      const due = [];
      for (const f of this.fish) if (!f.alive && f.respawnAt <= time) due.push(f);
      if (due.length === 0) return;
      if (due.length < 6 && time - this.lastSpawn < 9) return;
      this.lastSpawn = time;
      const side = randInt(0, 3);
      const along = rand(0.15, 0.85);
      const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;
      const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;
      const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
      const species = pickSpecies();
      const sp = SPECIES[species];
      const millDir = Math.random() < 0.5 ? 1 : -1;
      for (const f of due.slice(0, sp.schoolSize[1])) {
        f.alive = true;
        f.species = species;
        f.alarm = 0;
        f.startledUntil = 0;
        f.turn = 0;
        f.millDir = millDir;
        f.x = x + rand(-1, 1) * this.perception;
        f.y = y + rand(-1, 1) * this.perception;
        f.vx = Math.cos(inward) * sp.cruise * 1.4;
        f.vy = Math.sin(inward) * sp.cruise * 1.4;
      }
    }
  };

  // src/qingjing.ts
  var qingjing = [
    "\u8001\u541B\u66F0\u5927\u9053\u65E0\u5F62\u751F\u80B2\u5929\u5730\u5927\u9053\u65E0\u60C5\u8FD0\u884C\u65E5\u6708\u5927\u9053\u65E0\u540D\u957F\u517B\u4E07\u7269\u543E\u4E0D\u77E5\u5176\u540D\u5F3A\u540D\u66F0\u9053\u592B\u9053\u8005\u6709\u6E05\u6709\u6D4A\u6709\u52A8\u6709\u9759\u5929\u6E05\u5730\u6D4A\u5929\u52A8\u5730\u9759\u7537\u6E05\u5973\u6D4A\u7537\u52A8\u5973\u9759\u964D\u672C\u6D41\u672B\u800C\u751F\u4E07\u7269\u6E05\u8005\u6D4A\u4E4B\u6E90\u52A8\u8005\u9759\u4E4B\u57FA\u4EBA\u80FD\u5E38\u6E05\u9759\u5929\u5730\u6089\u7686\u5F52",
    "\u592B\u4EBA\u795E\u597D\u6E05\u800C\u5FC3\u6270\u4E4B\u4EBA\u5FC3\u597D\u9759\u800C\u6B32\u7275\u4E4B\u5E38\u80FD\u9063\u5176\u6B32\u800C\u5FC3\u81EA\u9759\u6F84\u5176\u5FC3\u800C\u795E\u81EA\u6E05\u81EA\u7136\u516D\u6B32\u4E0D\u751F\u4E09\u6BD2\u6D88\u706D\u6240\u4EE5\u4E0D\u80FD\u8005\u4E3A\u5FC3\u672A\u6F84\u6B32\u672A\u9063\u4E5F\u80FD\u9063\u4E4B\u8005\u5185\u89C2\u5176\u5FC3\u5FC3\u65E0\u5176\u5FC3\u5916\u89C2\u5176\u5F62\u5F62\u65E0\u5176\u5F62\u8FDC\u89C2\u5176\u7269\u7269\u65E0\u5176\u7269\u4E09\u8005\u65E2\u609F\u552F\u89C1\u4E8E\u7A7A\u89C2\u7A7A\u4EA6\u7A7A\u7A7A\u65E0\u6240\u7A7A\u6240\u7A7A\u65E2\u65E0\u65E0\u65E0\u4EA6\u65E0\u65E0\u65E0\u65E2\u65E0\u6E5B\u7136\u5E38\u5BC2\u5BC2\u65E0\u6240\u5BC2\u6B32\u5C82\u80FD\u751F\u6B32\u65E2\u4E0D\u751F\u5373\u662F\u771F\u9759\u771F\u9759\u5E94\u7269\u771F\u5E38\u5F97\u6027\u5E38\u5E94\u5E38\u9759\u5E38\u6E05\u9759\u77E3\u5982\u6B64\u6E05\u9759\u6E10\u5165\u771F\u9053\u65E2\u5165\u771F\u9053\u540D\u8C13\u5F97\u9053\u867D\u540D\u5F97\u9053\u5B9E\u65E0\u6240\u5F97\u4E3A\u5316\u4F17\u751F\u540D\u8C13\u5F97\u9053\u80FD\u609F\u4E4B\u8005\u53EF\u4F20\u5723\u9053",
    "\u8001\u541B\u66F0\u4E0A\u58EB\u65E0\u4E89\u4E0B\u58EB\u597D\u4E89\u4E0A\u5FB7\u4E0D\u5FB7\u4E0B\u5FB7\u6267\u5FB7\u6267\u8457\u4E4B\u8005\u4E0D\u540D\u9053\u5FB7\u4F17\u751F\u6240\u4EE5\u4E0D\u5F97\u771F\u9053\u8005\u4E3A\u6709\u5984\u5FC3\u65E2\u6709\u5984\u5FC3\u5373\u60CA\u5176\u795E\u65E2\u60CA\u5176\u795E\u5373\u8457\u4E07\u7269\u65E2\u8457\u4E07\u7269\u5373\u751F\u8D2A\u6C42\u65E2\u751F\u8D2A\u6C42\u5373\u662F\u70E6\u607C\u70E6\u607C\u5984\u60F3\u5FE7\u82E6\u8EAB\u5FC3\u4FBF\u906D\u6D4A\u8FB1\u6D41\u6D6A\u751F\u6B7B\u5E38\u6C89\u82E6\u6D77\u6C38\u5931\u771F\u9053\u771F\u5E38\u4E4B\u9053\u609F\u8005\u81EA\u5F97\u5F97\u609F\u9053\u8005\u5E38\u6E05\u9759\u77E3",
    "\u4ED9\u4EBA\u845B\u7384\u66F0\u543E\u5F97\u771F\u9053\u66FE\u8BF5\u6B64\u7ECF\u4E07\u904D\u6B64\u7ECF\u662F\u5929\u4EBA\u6240\u4E60\u4E0D\u4F20\u4E0B\u58EB\u543E\u6614\u53D7\u4E4B\u4E8E\u4E1C\u534E\u5E1D\u541B\u4E1C\u534E\u5E1D\u541B\u53D7\u4E4B\u4E8E\u91D1\u9619\u5E1D\u541B\u91D1\u9619\u5E1D\u541B\u53D7\u4E4B\u4E8E\u897F\u738B\u6BCD\u897F\u738B\u6BCD\u7686\u53E3\u53E3\u76F8\u4F20\u4E0D\u8BB0\u6587\u5B57\u543E\u4ECA\u4E8E\u4E16\u4E66\u800C\u5F55\u4E4B\u4E0A\u58EB\u609F\u4E4B\u5347\u4E3A\u5929\u5B98\u4E2D\u58EB\u4FEE\u4E4B\u5357\u5BAB\u5217\u4ED9\u4E0B\u58EB\u5F97\u4E4B\u5728\u4E16\u957F\u5E74\u6E38\u884C\u4E09\u754C\u5347\u5165\u91D1\u95E8",
    "\u5DE6\u7384\u771F\u4EBA\u66F0\u5B66\u9053\u4E4B\u58EB\u6301\u8BF5\u6B64\u7ECF\u5373\u5F97\u5341\u5929\u5584\u795E\u62E5\u62A4\u5176\u4EBA\u7136\u540E\u7389\u7B26\u4FDD\u795E\u91D1\u6DB2\u70BC\u5F62\u5F62\u795E\u4FF1\u5999\u4E0E\u9053\u5408\u771F",
    "\u6B63\u4E00\u771F\u4EBA\u66F0\u4EBA\u5BB6\u6709\u6B64\u7ECF\u609F\u89E3\u4E4B\u8005\u707E\u969C\u4E0D\u5E72\u4F17\u5723\u62A4\u95E8\u795E\u5347\u4E0A\u754C\u671D\u62DC\u9AD8\u5C0A\u529F\u6EE1\u5FB7\u5C31\u76F8\u611F\u5E1D\u541B\u8BF5\u6301\u4E0D\u9000\u8EAB\u817E\u7D2B\u4E91"
  ].join("");

  // src/deep-water.ts
  var shafts = [
    { origin: 0.42, drift: 0.23, spread: 0.11, strength: 0.16 },
    { origin: 0.54, drift: 0.3, spread: 0.08, strength: 0.25 },
    { origin: 0.64, drift: 0.34, spread: 0.16, strength: 0.3 },
    { origin: 0.75, drift: 0.29, spread: 0.08, strength: 0.22 },
    { origin: 0.83, drift: 0.23, spread: 0.12, strength: 0.18 }
  ];
  var particles = Array.from({ length: 96 }, (_, i) => ({
    x: hash3(i, 2, 15),
    y: hash3(i, 3, 15),
    size: 0.45 + hash3(i, 4, 15) * 1.2,
    speed: 1e-3 + hash3(i, 5, 15) * 3e-3
  }));
  function paintDeepWater(ctx, width, height) {
    if (!width || !height) return;
    const base = ctx.createLinearGradient(width * 0.65, 0, width * 0.2, height);
    base.addColorStop(0, "#0b5c7c");
    base.addColorStop(0.46, "#0a3c57");
    base.addColorStop(1, "#051e31");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.scale(width, height);
    const surface = ctx.createRadialGradient(0.66, -0.1, 0.02, 0.66, -0.1, 0.64);
    surface.addColorStop(0, "rgba(154,239,255,0.68)");
    surface.addColorStop(0.38, "rgba(54,202,242,0.30)");
    surface.addColorStop(1, "rgba(21,141,181,0)");
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, 1, 1);
    for (const { origin, drift, spread, strength } of shafts) {
      const attenuation = ctx.createLinearGradient(0, 0, 0, 1);
      attenuation.addColorStop(0, `rgba(171,246,255,${strength * 0.135})`);
      attenuation.addColorStop(0.44, `rgba(99,224,254,${strength * 0.087})`);
      attenuation.addColorStop(1, "rgba(60,193,240,0)");
      ctx.fillStyle = attenuation;
      for (let layer = 20; layer > 0; layer--) {
        const band = layer / 20;
        ctx.beginPath();
        ctx.moveTo(origin - spread * band * 0.2, 0);
        ctx.lineTo(origin + spread * band * 0.2, 0);
        ctx.lineTo(origin + drift + spread * band, 1);
        ctx.lineTo(origin + drift - spread * band, 1);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawSuspendedParticles(ctx, width, height, time) {
    ctx.save();
    ctx.fillStyle = "#b3eeff";
    for (const particle of particles) {
      const x = (particle.x + time * particle.speed * 0.45) % 1;
      const y = (particle.y + time * particle.speed) % 1;
      let light = 0;
      for (const { origin, drift, spread, strength } of shafts) {
        const reach = spread * (0.2 + 0.8 * y);
        const distance = Math.abs(x - origin - drift * y) / reach;
        light += Math.max(0, 1 - distance) * strength;
      }
      ctx.globalAlpha = (0.035 + light * 1.8) * (1 - y * 0.82);
      ctx.fillRect(x * width, y * height, particle.size, particle.size);
    }
    ctx.restore();
  }

  // src/renderer.ts
  var BRAILLE_DOTS = [
    [0.27, 0.13, 1],
    [0.27, 0.37, 2],
    [0.27, 0.63, 4],
    [0.27, 0.87, 64],
    [0.73, 0.13, 8],
    [0.73, 0.37, 16],
    [0.73, 0.63, 32],
    [0.73, 0.87, 128]
  ];
  var DOT_THRESHOLDS = [0.06, 0.55, 0.31, 0.8, 0.68, 0.18, 0.93, 0.43];
  var ALPHA_LEVELS = 6;
  var FISH_ALPHAS = [0.28, 0.42, 0.58, 0.74, 0.9];
  var DOT_RGB = [
    [48, 52, 235],
    [52, 205, 60],
    [228, 50, 44],
    [190, 212, 255],
    [110, 230, 255]
  ];
  var DOT_BASE_ALPHA = [1, 1, 1, 1, 1];
  var WAKE = DOT_RGB.length - 1;
  var ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
  var NIGHT_ACCENTS = ["#b2bfa9", "#c2b2ac", "#a79fbd", "#79bec5", "#8db3a8", "#8aabd0", "#bfba99"];
  var SKIN_RAMP = ":;t%SX8#@";
  var FIN_GLYPHS = "%;tS:";
  var RIDGE_GLYPHS = "@8%";
  var EDGE_HEAVY = ":;";
  var EDGE_LIGHT = ".',`";
  var FLAG_BODY = 1;
  var FLAG_EDGE = 2;
  var FLAG_FIN = 3;
  var FLAG_RIDGE = 4;
  var FLAG_EYE = 5;
  var FLAG_MARK = 6;
  var FLAG_TAIL = 7;
  var MARK_GLYPHS = "#%@";
  var SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];
  function classicHalfWidth(s) {
    if (s < 0.13) return 0.09 * Math.pow(Math.sin(s / 0.13 * Math.PI / 2), 0.95);
    if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
    if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
    const k = (s - 0.84) / 0.16;
    return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
  }
  var SHAPES = {
    classic: {
      halfWidth: classicHalfWidth,
      pectoral: [0.15, 0.43, 0.55, 0.26],
      falcate: true,
      pelvic: [0.57, 0.65, 0.69, 0.085],
      caudal: 0.085,
      dorsal: [0.33, 0.47],
      secondDorsal: [0.71, 0.76],
      eye: [0.1, 0.14],
      gills: [0.19, 0.29],
      tint: [0.92, 0.97, 1.05]
    },
    // Slim neck under a wide, swept-back cephalofoil (drawn in sampleShark),
    // tall first dorsal, long upper tail lobe. Bronze-olive grey.
    hammerhead: {
      halfWidth: (s) => {
        if (s < 0.06) return 0.045;
        if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);
        return classicHalfWidth(s) * 0.92;
      },
      head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
      pectoral: [0.17, 0.4, 0.5, 0.22],
      falcate: true,
      pelvic: [0.56, 0.63, 0.67, 0.075],
      caudal: 0.11,
      dorsal: [0.28, 0.44],
      secondDorsal: [0.7, 0.74],
      eye: null,
      gills: [0.16, 0.26],
      tint: [0.96, 0.98, 0.9]
    },
    // Blunt, square snout on a heavy body; barred back. Warm grey-brown.
    tiger: {
      halfWidth: (s) => {
        if (s < 0.13) return 0.1 * Math.pow(Math.sin(s / 0.13 * Math.PI / 2), 0.45);
        if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
        if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);
        const k = (s - 0.84) / 0.16;
        return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
      },
      pectoral: [0.15, 0.42, 0.53, 0.25],
      falcate: true,
      pelvic: [0.57, 0.65, 0.69, 0.085],
      caudal: 0.095,
      dorsal: [0.33, 0.46],
      secondDorsal: [0.71, 0.75],
      eye: [0.08, 0.12],
      gills: [0.19, 0.28],
      tint: [1.02, 0.95, 0.84]
    },
    // Short rounded head, body done by half-length, then a long ribbon of a
    // tail fin. Broad rounded pectorals, spotted sandy skin.
    zebra: {
      halfWidth: (s) => {
        if (s < 0.1) return 0.075 * Math.pow(Math.sin(s / 0.1 * Math.PI / 2), 0.7);
        if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
        if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);
        const k = (s - 0.55) / 0.45;
        return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);
      },
      pectoral: [0.12, 0.3, 0.36, 0.19],
      falcate: false,
      pelvic: [0.42, 0.48, 0.51, 0.065],
      caudal: 0,
      dorsal: [0.36, 0.44],
      secondDorsal: [0.49, 0.53],
      eye: [0.06, 0.09],
      gills: [0.13, 0.2],
      tint: [1.08, 0.97, 0.74]
    },
    // Great hammerhead: a broader, nearly straight-edged cephalofoil with a notch at the centre,
    // a towering sickle first dorsal (drawn long and bright from above), and a cooler slate skin.
    greathammer: {
      halfWidth: (s) => {
        if (s < 0.05) return 0.04;
        if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);
        return classicHalfWidth(s) * 0.95;
      },
      head: { span: 0.21, sweep: 6e-3, depth: 0.085, notch: 0.014 },
      pectoral: [0.16, 0.38, 0.49, 0.24],
      falcate: true,
      pelvic: [0.55, 0.62, 0.67, 0.085],
      caudal: 0.13,
      dorsal: [0.24, 0.45],
      secondDorsal: [0.68, 0.74],
      eye: null,
      gills: [0.15, 0.25],
      tint: [0.86, 0.93, 1.02]
    },
    // Shortfin mako: a long conical snout, a torpedo body that narrows hard to the tail stalk,
    // and a tall crescent tail. Metallic indigo back.
    mako: {
      halfWidth: (s) => {
        if (s < 0.17) return 0.088 * Math.pow(Math.sin(s / 0.17 * Math.PI / 2), 1.5);
        if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
        if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);
        const k = (s - 0.86) / 0.14;
        return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
      },
      pectoral: [0.18, 0.4, 0.5, 0.21],
      falcate: true,
      pelvic: [0.58, 0.64, 0.68, 0.06],
      caudal: 0.13,
      dorsal: [0.34, 0.45],
      secondDorsal: [0.76, 0.79],
      eye: [0.11, 0.15],
      gills: [0.2, 0.3],
      tint: [0.78, 0.9, 1.2]
    },
    // Thresher: a compact body over the front half, then the upper tail lobe as a long whip
    // that's as long as the shark itself. Big eyes, long sickle pectorals, bronze-violet skin.
    thresher: {
      halfWidth: (s) => {
        if (s < 0.08) return 0.07 * Math.pow(Math.sin(s / 0.08 * Math.PI / 2), 0.75);
        if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
        if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);
        const k = (s - 0.48) / 0.52;
        return 0.012 * (1 - k) + 6e-3 * Math.sin(k * Math.PI * 0.9) + 2e-3;
      },
      pectoral: [0.12, 0.27, 0.36, 0.2],
      falcate: true,
      pelvic: [0.37, 0.41, 0.44, 0.045],
      caudal: 0,
      dorsal: [0.24, 0.32],
      secondDorsal: [0.45, 0.47],
      eye: [0.05, 0.1],
      gills: [0.11, 0.18],
      tint: [1, 0.9, 1.08]
    },
    // Nurse shark: a blunt, broad head, a heavy flattened body with both dorsals set far back,
    // rounded paddle pectorals, and a long low tail with no lower lobe. Tawny brown.
    nurse: {
      halfWidth: (s) => {
        if (s < 0.08) return 0.085 * Math.pow(Math.sin(s / 0.08 * Math.PI / 2), 0.4);
        if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
        if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);
        const k = (s - 0.72) / 0.28;
        return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);
      },
      pectoral: [0.16, 0.34, 0.4, 0.17],
      falcate: false,
      pelvic: [0.45, 0.52, 0.55, 0.075],
      caudal: 0,
      dorsal: [0.5, 0.58],
      secondDorsal: [0.63, 0.69],
      eye: [0.05, 0.075],
      gills: [0.14, 0.22],
      tint: [1.1, 0.96, 0.76]
    },
    // A manta's curved disc, cephalic lobes and pale dorsal patches are sampled separately.
    manta: {
      halfWidth: (s) => {
        if (s < 0.08) return 0.06 + 0.025 * smoothstep(0, 0.08, s);
        if (s < 0.48) return 0.018 + 0.075 * Math.sin((s - 0.08) / 0.4 * Math.PI);
        return 8e-3 * (1 - (s - 0.48) / 0.52) + 2e-3;
      },
      pectoral: [0.045, 0.56, 0.3, 0.6],
      falcate: false,
      pelvic: [0.4, 0.5, 0.52, 0.055],
      caudal: 0,
      dorsal: [2, 2],
      secondDorsal: [2, 2],
      eye: [0.065, 0.14],
      gills: [2, 2],
      tint: [0.85, 0.96, 1.04]
    },
    // A broad, blunt head, a heavy torso and regularly spaced skin spots.
    whaleshark: {
      halfWidth: (s) => {
        if (s < 0.08) return 0.105 + 0.027 * smoothstep(0, 0.08, s);
        if (s < 0.32) return 0.132;
        if (s < 0.86) return 0.018 + 0.114 * Math.pow(1 - (s - 0.32) / 0.54, 1.1);
        return 0.018 * (1 - (s - 0.86) / 0.14) + 3e-3;
      },
      pectoral: [0.18, 0.45, 0.56, 0.24],
      falcate: false,
      pelvic: [0.61, 0.7, 0.75, 0.09],
      caudal: 0.12,
      dorsal: [0.39, 0.48],
      secondDorsal: [0.73, 0.77],
      eye: [0.025, 0.09],
      gills: [0.16, 0.29],
      tint: [0.72, 0.94, 1.16]
    },
    // A rounded, short body with opposing tall fins and a small scalloped tail.
    sunfish: {
      halfWidth: (s) => {
        if (s < 0.12) return 0.06 + 0.095 * smoothstep(0, 0.12, s);
        if (s < 0.76) return 0.075 + 0.14 * Math.pow(Math.sin((s - 0.12) / 0.64 * Math.PI), 0.8);
        return 0.065 * (1 - (s - 0.76) / 0.24) + 0.018;
      },
      pectoral: [0.15, 0.28, 0.33, 0.18],
      falcate: false,
      pelvic: [0.4, 0.78, 0.66, 0.34],
      caudal: 0.045,
      dorsal: [0.42, 0.7],
      secondDorsal: [2, 2],
      eye: [0.055, 0.14],
      gills: [0.16, 0.21],
      tint: [0.99, 1.02, 0.88]
    }
  };
  var KINDS = Object.keys(SHAPES);
  function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }
  function paintGrid(g, W, H, cw, ch, dpr, dark = false) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = dark ? "rgba(133,183,202,0.035)" : "rgba(255,255,255,0.055)";
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 0; c <= Math.ceil(W / cw); c++) {
      const x = Math.round(c * cw * dpr) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, H * dpr);
    }
    for (let r = 0; r <= Math.ceil(H / ch); r++) {
      const y = Math.round(r * ch * dpr) + 0.5;
      g.moveTo(0, y);
      g.lineTo(W * dpr, y);
    }
    g.stroke();
  }
  var AsciiRenderer = class {
    constructor(canvas) {
      this.canvas = canvas;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("2D canvas unavailable");
      this.ctx = ctx;
      this.bg = document.createElement("canvas");
      for (let c = 0; c < DOT_RGB.length; c++) {
        const [r, g, b] = DOT_RGB[c];
        for (let l = 0; l < ALPHA_LEVELS; l++) {
          const a = DOT_BASE_ALPHA[c] * (l + 1) / ALPHA_LEVELS;
          this.dotStyles.push(`rgba(${r},${g},${b},${a.toFixed(3)})`);
        }
      }
    }
    ctx;
    bg;
    dpr = 1;
    width = 0;
    height = 0;
    cw = 12;
    ch = 18;
    cols = 0;
    rows = 0;
    fontFamily = "ui-monospace, Menlo, monospace";
    mode = "ascii";
    theme = "light";
    dark = false;
    dotKind = new Uint8Array(0);
    // 0 none, 1 blue, 2 green, 3 red, 4 pale
    dotPhase = new Float32Array(0);
    dotFreq = new Float32Array(0);
    energy = new Float32Array(0);
    energyTmp = new Float32Array(0);
    heat = new Float32Array(0);
    bucketOf = new Uint8Array(0);
    bucketOrder = new Int32Array(0);
    bucketCounts = new Int32Array(DOT_RGB.length * ALPHA_LEVELS + 1);
    dotStyles = [];
    sharkFlag = new Uint8Array(0);
    sharkShade = new Float32Array(0);
    sharkKey = new Uint32Array(0);
    sharkDepth = new Float32Array(0);
    sharkKind = new Uint8Array(0);
    sharkDots = new Uint8Array(0);
    sharkAngle = new Float32Array(0);
    /** Cells darkened by a shark's shadow on the seabed. */
    sharkShadow = new Uint8Array(0);
    spine = new Float32Array(SHARK_NODES * 2);
    arc = new Float32Array(SHARK_NODES);
    arcTotal = 1;
    shape = SHAPES.classic;
    sharkId = 0;
    finTipLeft = 0;
    finTipRight = 0;
    // Scratch outputs of sampleShark(), to avoid allocating per sample.
    hitFlag = 0;
    hitShade = 0;
    hitS = 0;
    hitV = 0;
    hitDist = 0;
    hitAngle = 0;
    /** Cells holding a fish this frame (frame stamp); dots skip them. */
    fishStamp = new Uint32Array(0);
    fishGlyph = new Uint16Array(0);
    fishEscapeHeading = new Float32Array(0);
    frameId = 0;
    /** Fish cells bucketed by brightness, so each bucket is one fillStyle. */
    fishBuckets = FISH_ALPHAS.map(() => []);
    fishStyles = FISH_ALPHAS.map((a) => `rgba(230,238,255,${a})`);
    get cellWidth() {
      return this.cw;
    }
    get cellHeight() {
      return this.ch;
    }
    setFontFamily(family) {
      if (family) this.fontFamily = family;
    }
    setMode(mode) {
      if (this.mode === mode) return;
      this.mode = mode;
      this.paintBackground();
    }
    setTheme(theme2) {
      this.theme = theme2;
      this.dark = theme2 !== "light";
      const fishColor = theme2 === "deep" ? "210,240,248" : this.dark ? "139,182,196" : "230,238,255";
      this.fishStyles = FISH_ALPHAS.map((a) => `rgba(${fishColor},${this.dark ? a * 0.85 : a})`);
      this.paintBackground();
    }
    resize(width, height, dpr) {
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.cw = clamp(Math.round(width / 124), 8, 13);
      this.ch = Math.round(this.cw * 1.45);
      this.cols = Math.ceil(width / this.cw);
      this.rows = Math.ceil(height / this.ch);
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.bg.width = this.canvas.width;
      this.bg.height = this.canvas.height;
      const n = this.cols * this.rows;
      this.dotKind = new Uint8Array(n);
      this.dotPhase = new Float32Array(n);
      this.dotFreq = new Float32Array(n);
      this.energy = new Float32Array(n);
      this.energyTmp = new Float32Array(n);
      this.heat = new Float32Array(n);
      this.bucketOf = new Uint8Array(n);
      this.bucketOrder = new Int32Array(n);
      this.sharkFlag = new Uint8Array(n);
      this.sharkShade = new Float32Array(n);
      this.sharkKey = new Uint32Array(n);
      this.sharkDepth = new Float32Array(n);
      this.sharkKind = new Uint8Array(n);
      this.sharkDots = new Uint8Array(n);
      this.sharkAngle = new Float32Array(n);
      this.sharkShadow = new Uint8Array(n);
      this.fishStamp = new Uint32Array(n);
      this.fishGlyph = new Uint16Array(n);
      this.fishEscapeHeading = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const col = i % this.cols;
        const row = i / this.cols | 0;
        this.dotKind[i] = 0;
        this.dotPhase[i] = hash3(col, row, 23) * Math.PI * 2;
        this.dotFreq[i] = 0.3 + hash3(col, row, 37) * 1.1;
      }
      this.paintBackground();
    }
    paintBackground() {
      const g = this.bg.getContext("2d");
      if (!g) return;
      const { width: W, height: H, dpr, cw, ch } = this;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.theme === "deep") {
        paintDeepWater(g, W, H);
        return;
      } else if (this.dark) {
        const water = g.createRadialGradient(W * 0.5, H * 0.49, 0, W * 0.5, H * 0.49, Math.hypot(W, H) * 0.62);
        water.addColorStop(0, "#10252f");
        water.addColorStop(0.48, "#0b1923");
        water.addColorStop(1, "#07111a");
        g.fillStyle = water;
      } else {
        g.fillStyle = "#000";
      }
      g.fillRect(0, 0, W, H);
      paintGrid(g, W, H, cw, ch, dpr, this.dark);
    }
    render(world, dt) {
      const { ctx, dpr, cols, ch } = this;
      if (cols === 0) return;
      const t = world.time;
      this.consumeEvents(world);
      this.rasterizeSharks(world.sharks, t);
      this.depositWake(world);
      this.diffuse(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.theme === "deep") drawSuspendedParticles(ctx, this.width, this.height, t);
      ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.markFish(world);
      this.drawDots(t);
      this.drawRipple(world);
      this.drawHeat();
      this.drawFish();
      this.drawSharks(t);
    }
    // ── simulation → field ──────────────────────────────────────────────
    cellIndex(x, y) {
      const c = Math.floor(x / this.cw);
      const r = Math.floor(y / this.ch);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
      return r * this.cols + c;
    }
    stamp(field, x, y, radius, amount) {
      const c0 = Math.floor(x / this.cw);
      const r0 = Math.floor(y / this.ch);
      for (let r = r0 - radius; r <= r0 + radius; r++) {
        for (let c = c0 - radius; c <= c0 + radius; c++) {
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const d = Math.hypot(c - c0, (r - r0) * 1.4);
          if (d > radius + 0.5) continue;
          const i = r * this.cols + c;
          field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
        }
      }
    }
    consumeEvents(world) {
      for (const e of world.events) {
        if (e.kind === "eat") {
          this.stamp(this.heat, e.x, e.y, 2, 1);
          this.stamp(this.energy, e.x, e.y, 3, 0.9);
        } else {
          this.stamp(this.energy, e.x, e.y, 6, 1.4);
        }
      }
      world.events.length = 0;
    }
    depositWake(world) {
      const { energy } = this;
      for (const f of world.fish) {
        if (!f.alive) continue;
        const i = this.cellIndex(f.x, f.y);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.012 + f.alarm * 0.03);
      }
      for (const sh of world.sharks) {
        for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {
          const i = this.cellIndex(sh.nodes[k * 2], sh.nodes[k * 2 + 1]);
          if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.05 + sh.speed * 12e-4);
        }
      }
      if (world.pointer.active) {
        this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
      }
    }
    /** Blur + decay so wakes spread out like ripples and fade. */
    diffuse(dt) {
      const { cols, rows, energy, energyTmp: tmp, heat } = this;
      const decay = Math.exp(-dt * 1.5);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const l = c > 0 ? energy[i - 1] : energy[i];
          const rt = c < cols - 1 ? energy[i + 1] : energy[i];
          const u = r > 0 ? energy[i - cols] : energy[i];
          const d = r < rows - 1 ? energy[i + cols] : energy[i];
          tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
        }
      }
      this.energy = tmp;
      this.energyTmp = energy;
      const heatDecay = Math.exp(-dt * 2.2);
      for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
    }
    // ── sharks ──────────────────────────────────────────────────────────
    /**
     * Classify one point against the current shark (spine/arc already built).
     * Body coordinates: s along the spine (0 snout → 1 tail), v across it.
     * Writes hit* fields and returns whether the point is on the shark.
     */
    sampleShark(px, py, L) {
      if (this.shape === SHAPES.manta) return this.sampleManta(px, py, L);
      const { spine, arc } = this;
      const N = SHARK_NODES;
      let best = Infinity;
      let bestS = 0;
      let bestSign = 1;
      let bestNx = 0;
      let bestNy = 0;
      for (let k = 0; k < N - 1; k++) {
        const ax = spine[k * 2];
        const ay = spine[k * 2 + 1];
        const sx = spine[(k + 1) * 2] - ax;
        const sy = spine[(k + 1) * 2 + 1] - ay;
        const len2 = sx * sx + sy * sy || 1;
        const u2 = clamp(((px - ax) * sx + (py - ay) * sy) / len2, 0, 1);
        const qx = ax + sx * u2;
        const qy = ay + sy * u2;
        const d2 = (px - qx) ** 2 + (py - qy) ** 2;
        if (d2 < best) {
          best = d2;
          const len = Math.sqrt(len2);
          bestS = (arc[k] + u2 * len) / this.arcTotal;
          bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
          bestNx = -sy / len * bestSign;
          bestNy = sx / len * bestSign;
          this.hitAngle = Math.atan2(sy, sx);
        }
      }
      const a = Math.sqrt(best);
      const s = bestS;
      const u = s * L;
      const shape = this.shape;
      const w = shape.halfWidth(s) * L;
      this.hitDist = a;
      this.hitS = s;
      this.hitV = a * bestSign;
      const head = this.shape.head;
      if (head && u < L * (head.sweep + head.depth + head.notch)) {
        const span = L * head.span;
        const r = a / span;
        const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
        const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
        if (r <= 1 && u >= front && u <= front + depth) {
          this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;
          this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
          return true;
        }
      }
      if (a <= w) {
        const across = a / (w || 1);
        const facing = (bestNx * -0.6 + bestNy * -0.8) * across;
        let shade = 0.58 - across * across * 0.42 + facing * 0.26;
        let flag = FLAG_BODY;
        if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
          flag = FLAG_RIDGE;
          shade = 1;
        } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
          shade = Math.max(shade, 0.82);
        } else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {
          flag = FLAG_EYE;
          shade = 0;
        } else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
          if (Math.floor((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0]) * 5) % 2 === 0) shade *= 0.45;
        } else if (s < 0.05) {
          shade = Math.max(shade, 0.7);
        } else if (shape === SHAPES.zebra && s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) {
          shade = Math.max(shade, 0.8);
        } else if (this.marked(s, a * bestSign, L, across)) {
          flag = FLAG_MARK;
        }
        this.hitFlag = flag;
        this.hitShade = shade;
        return true;
      }
      const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;
      const [p0, p1, p2] = shape.pectoral;
      if (inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) && // Falcate (sickle) fins get a concave trailing edge.
      !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))) {
        this.hitFlag = this.marked(s, a * bestSign, L, 0) ? FLAG_MARK : FLAG_FIN;
        this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));
        return true;
      }
      const [v0, v1, v2, vr] = shape.pelvic;
      if (inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) || // Forked caudal fin.
      shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal)) {
        this.hitFlag = FLAG_FIN;
        this.hitShade = 0.36;
        return true;
      }
      return false;
    }
    /** Broad, curved manta disc in a stable frame; the whip follows the flexible spine. */
    sampleManta(px, py, L) {
      const { spine } = this;
      const dx = spine[20] - spine[0];
      const dy = spine[21] - spine[1];
      const axisLength = Math.hypot(dx, dy) || 1;
      const tx = dx / axisLength;
      const ty = dy / axisLength;
      const localLength = axisLength * (SHARK_NODES - 1) / 10;
      const x = px - spine[0];
      const y = py - spine[1];
      const s = (x * tx + y * ty) / localLength;
      const v = -x * ty + y * tx;
      const a = Math.abs(v) / localLength;
      const reach = (v > 0 ? this.finTipRight : this.finTipLeft) / L;
      const q = a / reach;
      this.hitS = s;
      this.hitV = v;
      this.hitDist = Math.abs(v);
      this.hitAngle = Math.atan2(ty, tx);
      this.hitFlag = FLAG_BODY;
      this.hitShade = 0.2;
      const lobeCentre = 0.075 + 0.12 * Math.max(0, s);
      if (s >= -0.045 && s <= 0.065) {
        const lobeWidth = 9e-3 + 9e-3 * smoothstep(-0.045, 0.05, s);
        if (Math.abs(a - lobeCentre) < lobeWidth * Math.sqrt(Math.max(0, 1 - ((s - 0.01) / 0.055) ** 2))) {
          this.hitFlag = s < 0 ? FLAG_RIDGE : FLAG_BODY;
          this.hitShade = s < 0 ? 0.95 : 0.36;
          return true;
        }
      }
      const front = 0.022 + 0.278 * Math.pow(q, 1.45) + 0.016 * Math.exp(-q * q / 0.012);
      const back = 0.56 - 0.25 * Math.pow(q, 0.7);
      if (q <= 1 && s >= front && s <= back) {
        const shoulder = ((a - 0.112) / 0.05) ** 2 + ((s - 0.092 - (a - 0.112) * 0.7) / 0.025) ** 2;
        const wingBand = front + 0.025 + 0.025 * Math.sin(q * Math.PI);
        const paleWing = q > 0.42 && Math.abs(s - wingBand) < 9e-3 + 0.013 * smoothstep(0.65, 1, q);
        const rearRidge = Math.abs(a - (0.56 - s) * 0.25) < 8e-3 && s > 0.29;
        const mouthRim = a < 0.08 && s - front < 8e-3;
        this.hitShade = 0.16 + 0.15 * (1 - q) + 0.08 * Math.sin((s - front) / (back - front) * Math.PI);
        if (shoulder < 1 || paleWing || rearRidge || mouthRim) {
          this.hitFlag = FLAG_RIDGE;
          this.hitShade = 0.9 + 0.1 * (1 - Math.min(1, shoulder));
        } else if (s > 0.05 && s < 0.09 && a > 0.09 && a < 0.115) {
          this.hitFlag = FLAG_EYE;
          this.hitShade = 0;
        }
        return true;
      }
      if (s > 0.48) {
        for (let k = 10; k < SHARK_NODES - 1; k++) {
          const ax = spine[k * 2];
          const ay = spine[k * 2 + 1];
          const sx = spine[k * 2 + 2] - ax;
          const sy = spine[k * 2 + 3] - ay;
          const len2 = sx * sx + sy * sy || 1;
          const along = ((px - ax) * sx + (py - ay) * sy) / len2;
          if (along < 0 || along > 1) continue;
          const distance = Math.hypot(px - ax - sx * along, py - ay - sy * along);
          const tailS = (k + along) / (SHARK_NODES - 1);
          const width = Math.max(this.cw * 0.22, L * (45e-4 - tailS * 25e-4));
          if (distance <= width) {
            this.hitS = tailS;
            this.hitV = distance;
            this.hitFlag = FLAG_TAIL;
            this.hitShade = 0.76;
            this.hitAngle = Math.atan2(sy, sx);
            return true;
          }
        }
      }
      return false;
    }
    /** Whether a body point (s along, v across) falls on a dark marking. */
    marked(s, v, L, across) {
      if (this.shape === SHAPES.whaleshark) {
        if (s < 0.1 || s > 0.81) return false;
        const u = s / 0.052;
        const w = v / (L * 0.043);
        const x = u - Math.floor(u) - 0.5;
        const y = w - Math.floor(w) - 0.5;
        return x * x + y * y < 0.075;
      }
      if (this.shape === SHAPES.tiger) {
        if (s < 0.2 || s > 0.9 || across > 0.85) return false;
        const wobble = 0.35 * Math.sin(v / L * 25 + s * 5);
        const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);
        return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s);
      }
      if (this.shape === SHAPES.zebra) {
        if (s < 0.07) return false;
        const gu = s * L / (L * 0.06);
        const gv = v / (L * 0.045);
        const cu = Math.floor(gu);
        const cv = Math.floor(gv);
        const jx = hash3(cu, cv, this.sharkId) * 0.5 + 0.25;
        const jy = hash3(cu, cv, this.sharkId + 11) * 0.5 + 0.25;
        return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08;
      }
      return false;
    }
    /**
     * Build a smooth, undulating render spine from the sim spine, then
     * supersample every cell in the shark's bounding box against the shape.
     * Fully covered cells become solid skin; partial cells become edge glyphs.
     */
    rasterizeSharks(sharks, t) {
      const { sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, sharkShadow, spine, arc, cw, ch, cols, rows } = this;
      sharkFlag.fill(0);
      sharkShadow.fill(0);
      this.sharkDots.fill(0);
      for (const sh of sharks) {
        const L = sh.length;
        const N = SHARK_NODES;
        const n = sh.nodes;
        const swim = clamp(sh.speed / 60, 0.4, 1.4);
        this.shape = SHAPES[sh.kind];
        this.sharkId = sh.id;
        const kindIndex = KINDS.indexOf(sh.kind);
        for (let k = 0; k < N; k++) {
          const s = k / (N - 1);
          if (sh.kind === "manta") {
            const hx = n[0] - n[2];
            const hy = n[1] - n[3];
            const hl = Math.hypot(hx, hy) || 1;
            const tail = smoothstep(0.45, 1, s);
            const bend = L * tail * tail * (0.018 * Math.sin(sh.phase * 0.65 - s * 2.4) + 0.07 * clamp(sh.turn, -1, 1));
            spine[k * 2] = n[0] - hx / hl * L * s - hy / hl * bend;
            spine[k * 2 + 1] = n[1] - hy / hl * L * s + hx / hl * bend;
            continue;
          }
          const a = Math.max(0, k - 1);
          const b = Math.min(N - 1, k + 1);
          let tx = n[a * 2] - n[b * 2];
          let ty = n[a * 2 + 1] - n[b * 2 + 1];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const flexScale = sh.kind === "sunfish" ? 0.12 : sh.kind === "whaleshark" ? 0.65 : 1;
          const amp = L * 0.05 * flexScale * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;
          const off = amp * Math.sin(sh.phase - s * 5.2);
          spine[k * 2] = n[k * 2] - ty * off;
          spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
        }
        arc[0] = 0;
        for (let k = 1; k < N; k++) {
          arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
        }
        this.arcTotal = arc[N - 1] || 1;
        const bank = clamp(sh.turn * 0.45, -0.35, 0.35);
        const flex = sh.kind === "manta" ? 0.84 + 0.16 * Math.sin(sh.phase * 0.65) : 1 + 0.06 * Math.sin(sh.phase * 0.5);
        const reachFin = this.shape.pectoral[3];
        this.finTipRight = L * reachFin * flex * (1 - bank);
        this.finTipLeft = L * reachFin * flex * (1 + bank);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < N; k++) {
          minX = Math.min(minX, spine[k * 2]);
          maxX = Math.max(maxX, spine[k * 2]);
          minY = Math.min(minY, spine[k * 2 + 1]);
          maxY = Math.max(maxY, spine[k * 2 + 1]);
        }
        const reach = sh.kind === "manta" ? Math.max(this.finTipRight, this.finTipLeft) + L * 0.06 : L * 0.36;
        const c0 = Math.max(0, Math.floor((minX - reach) / cw));
        const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
        const r0 = Math.max(0, Math.floor((minY - reach) / ch));
        const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
        if (c0 > c1 || r0 > r1) continue;
        const skipBeyond = reach + Math.hypot(cw, ch);
        const shadowDc = Math.round(L * 0.035 / cw) + 1;
        const shadowDr = Math.round(L * 0.02 / ch) + 1;
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const x = c * cw;
            const y = r * ch;
            const centerHit = this.sampleShark(x + cw / 2, y + ch / 2, L);
            if (!centerHit && this.hitDist > skipBeyond) continue;
            const flag = this.hitFlag;
            const shade = this.hitShade;
            const s = this.hitS;
            const v = this.hitV;
            const angle = this.hitAngle;
            let hits = centerHit ? 1 : 0;
            let tailHit = centerHit && flag === FLAG_TAIL;
            let tailAngle = angle;
            for (let k = 0; k < SUBSAMPLES.length; k += 2) {
              if (this.sampleShark(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, L)) {
                hits++;
                if (this.hitFlag === FLAG_TAIL) {
                  tailHit = true;
                  tailAngle = this.hitAngle;
                }
              }
            }
            let dots = 0;
            if (this.mode === "braille") {
              for (let d = 0; d < BRAILLE_DOTS.length; d++) {
                const [ox, oy, bit] = BRAILLE_DOTS[d];
                if (!this.sampleShark(x + ox * cw, y + oy * ch, L)) continue;
                const density = this.hitFlag === FLAG_EYE ? 1 : this.hitFlag === FLAG_MARK ? 0.3 : 0.36 + this.hitShade * 0.6;
                if (density >= DOT_THRESHOLDS[(d + (c + r) % 4) % 8]) dots |= bit;
              }
            }
            if (hits === 0 && dots === 0) continue;
            const coverage = hits / 5;
            const i = r * cols + c;
            const key = hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295 >>> 0;
            sharkKey[i] = key;
            sharkDepth[i] = sh.depth;
            sharkKind[i] = kindIndex;
            this.sharkDots[i] = dots;
            this.sharkAngle[i] = angle;
            if (tailHit && (!centerHit || flag === FLAG_TAIL)) {
              sharkFlag[i] = FLAG_TAIL;
              sharkShade[i] = 0.76;
              this.sharkAngle[i] = tailAngle;
            } else if (centerHit && coverage >= 0.6) {
              sharkFlag[i] = flag;
              const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06;
              sharkShade[i] = clamp(shade + flicker, 0, 1);
              const sc = c + shadowDc;
              const sr = r + shadowDr;
              if (sc < cols && sr < rows) sharkShadow[sr * cols + sc] = 1;
            } else {
              sharkFlag[i] = FLAG_EDGE;
              sharkShade[i] = coverage;
            }
          }
        }
        if (sh.kind === "manta" && this.mode !== "braille") {
          for (let k = 11; k < N - 1; k++) {
            const ax = spine[k * 2], ay = spine[k * 2 + 1];
            const dx = spine[k * 2 + 2] - ax, dy = spine[k * 2 + 3] - ay;
            const steps = Math.ceil(Math.hypot(dx, dy) / (cw * 0.25));
            for (let j = 0; j <= steps; j++) {
              const i = this.cellIndex(ax + dx * j / steps, ay + dy * j / steps);
              if (i < 0 || sharkFlag[i] && sharkFlag[i] !== FLAG_EDGE && sharkFlag[i] !== FLAG_TAIL) continue;
              sharkFlag[i] = FLAG_TAIL;
              sharkShade[i] = 0.76;
              sharkKind[i] = kindIndex;
              sharkDepth[i] = sh.depth;
              sharkKey[i] = (k + sh.id * 13) * 31 + j >>> 0;
              this.sharkAngle[i] = Math.atan2(dy, dx);
            }
          }
        }
      }
    }
    drawSharks(t) {
      if (this.mode !== "ascii") {
        this.drawSymbolSharks(t);
        return;
      }
      const { ctx, cols, rows, cw, ch, sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind } = this;
      const accents = this.dark ? NIGHT_ACCENTS : ACCENTS;
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const flag = sharkFlag[i];
        if (!flag) continue;
        const col = i % cols;
        const row = i / cols | 0;
        const x = col * cw;
        const y = row * ch;
        const key = sharkKey[i];
        const shade = sharkShade[i];
        const dim = 0.7 + 0.3 * sharkDepth[i];
        if (flag === FLAG_TAIL) {
          this.drawWhipCell(i, x, y, dim);
          continue;
        }
        const [tr, tg, tb] = SHAPES[KINDS[sharkKind[i]]].tint;
        const tick = Math.floor(t * 2.4 + key % 997 / 97);
        const roll = hash3(key, tick, 7);
        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const g = (this.dark ? 92 + shade * 73 : 70 + shade * 80) * dim;
          ctx.fillStyle = roll < 0.07 ? accents[key % accents.length] : `rgb(${Math.round(g * tr)},${Math.round(g * tg)},${Math.min(255, Math.round(g * tb + 6))})`;
          ctx.fillText(set[(key >>> 8) % set.length], x + cw / 2, y + ch / 2 + 1);
          continue;
        }
        let level;
        let glyph;
        if (flag === FLAG_RIDGE) {
          level = 226;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        } else if (flag === FLAG_EYE) {
          level = 12;
          glyph = "o";
        } else if (flag === FLAG_MARK) {
          level = 24 + shade * 22;
          glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
        } else if (flag === FLAG_FIN) {
          level = 40 + shade * 120;
          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
        } else {
          level = 46 + shade * 160;
          const jitter = (key >>> 4) % 3 - 1;
          glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }
        level *= dim * (this.dark ? 0.8 : 1);
        ctx.fillStyle = this.dark ? `rgb(${Math.round(level * tr * 0.78)},${Math.min(255, Math.round(level * tg * 0.99 + 8))},${Math.min(255, Math.round(level * tb * 1.08 + 15))})` : `rgb(${Math.min(255, Math.round(level * tr))},${Math.min(255, Math.round(level * tg))},${Math.min(255, Math.round(level * tb + 4))})`;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
        let color;
        if (flag === FLAG_EYE) color = this.dark ? "#a9d1d5" : "#9aa0ad";
        else if (flag === FLAG_MARK) color = `rgb(${Math.round(70 * tr)},${Math.round(70 * tg)},${Math.round(70 * tb)})`;
        else if (roll < 0.09) color = accents[key % accents.length];
        else if (roll < 0.13) color = this.dark ? "#bfd5df" : "#ffffff";
        else if (this.dark && KINDS[sharkKind[i]] === "manta") color = shade > 0.7 ? "#20313a" : "#43606e";
        else color = this.dark ? shade > 0.55 ? "#0e202b" : "#a2bac6" : shade > 0.55 ? "#0e0f13" : "#1b1d24";
        ctx.fillStyle = color;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
    /** Draw the same body grid using distinct symbol vocabularies, without resetting the world. */
    drawSymbolSharks(t) {
      const { ctx, cw, ch, cols, sharkFlag, sharkShade, sharkDepth, sharkKey, sharkKind } = this;
      const accents = this.dark ? NIGHT_ACCENTS : ACCENTS;
      ctx.save();
      ctx.font = this.mode === "hanzi" ? `500 ${Math.round(cw * 0.98)}px OceanHanzi, sans-serif` : `600 ${Math.round(ch * 0.9)}px ${this.fontFamily}`;
      for (let i = 0; i < sharkFlag.length; i++) {
        const flag = sharkFlag[i];
        if (!flag) continue;
        const x = i % cols * cw;
        const y = Math.floor(i / cols) * ch;
        const shade = sharkShade[i];
        const key = sharkKey[i];
        const edge = flag === FLAG_EDGE;
        const dim = 0.7 + sharkDepth[i] * 0.3;
        if (flag === FLAG_TAIL && this.mode === "geometry") {
          this.drawWhipCell(i, x, y, dim);
          continue;
        }
        const [tr, tg, tb] = SHAPES[KINDS[sharkKind[i]]].tint;
        const level = (flag === FLAG_MARK ? 90 : (120 + shade * 115) * dim) * (this.dark ? 0.82 : 1);
        const accent = hash3(key, Math.floor(t * 1.7), 17) < 0.035;
        ctx.fillStyle = accent ? accents[key % accents.length] : this.dark ? `rgb(${Math.round(level * tr * 0.84)},${Math.min(255, Math.round(level * tg + 8))},${Math.min(255, Math.round(level * tb * 1.06 + 12))})` : `rgb(${Math.min(255, Math.round(level * tr))},${Math.min(255, Math.round(level * tg))},${Math.min(255, Math.round(level * tb))})`;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.globalAlpha = edge ? 0.45 + shade * 0.4 : 1;
        if (this.mode === "braille") {
          const mask = this.sharkDots[i];
          const radius = Math.max(0.65, cw * 0.105);
          ctx.beginPath();
          for (const [ox, oy, bit] of BRAILLE_DOTS) {
            if (!(mask & bit)) continue;
            ctx.moveTo(x + ox * cw + radius, y + oy * ch);
            ctx.arc(x + ox * cw, y + oy * ch, radius, 0, Math.PI * 2);
          }
          ctx.fill();
          continue;
        }
        if (flag === FLAG_EYE && this.mode === "geometry") {
          ctx.beginPath();
          ctx.arc(x + cw / 2, y + ch / 2, Math.max(1.2, cw * 0.18), 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        if (this.mode === "geometry") {
          const cx = x + cw / 2, cy = y + ch / 2;
          const radius = cw * (edge ? 0.13 : 0.27 + shade * 0.15);
          const shape = (key >>> 4) % 4;
          ctx.lineWidth = Math.max(0.7, cw * 0.075);
          ctx.beginPath();
          if (edge || shape < 2) {
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          } else if (shape === 2) {
            ctx.moveTo(cx, cy - radius * 1.25);
            ctx.lineTo(cx + radius, cy);
            ctx.lineTo(cx, cy + radius * 1.25);
            ctx.lineTo(cx - radius, cy);
            ctx.closePath();
          } else {
            ctx.rect(cx - radius * 0.85, cy - radius * 0.85, radius * 1.7, radius * 1.7);
          }
          if (edge || shade > 0.6 || flag === FLAG_RIDGE) ctx.fill();
          else ctx.stroke();
          continue;
        }
        const glyph = qingjing[key % qingjing.length];
        ctx.globalAlpha *= edge ? 0.75 : 1;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1, cw * 0.98);
      }
      ctx.restore();
    }
    /** Fine aligned strokes keep the manta whip legible without solid tail blocks. */
    drawWhipCell(i, x, y, dim) {
      const { ctx, cw, ch } = this;
      const direction = (Math.round(this.sharkAngle[i] / (Math.PI / 4)) % 4 + 4) % 4;
      ctx.save();
      ctx.globalAlpha = 0.75 * dim;
      ctx.fillStyle = this.dark ? "#b0d2df" : "#a9bbc3";
      ctx.font = `400 ${Math.round(ch)}px ${this.fontFamily}`;
      ctx.fillText(["\u2500", "\u2572", "\u2502", "\u2571"][direction], x + cw / 2, y + ch / 2 + 1, cw * 1.1);
      ctx.restore();
    }
    // ── fish, dots, heat ────────────────────────────────────────────────
    /**
     * Snap each fish to a cell and bucket it by brightness: far fish are dim,
     * near fish brighter, and turning or panicking fish glint. Nearer fish
     * claim a cell first when two land in the same one.
     */
    markFish(world) {
      const { fishStamp, fishBuckets, sharkFlag } = this;
      const frame = ++this.frameId;
      for (const bucket of fishBuckets) bucket.length = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (const [fishIndex, f] of world.fish.entries()) {
          if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
          const i = this.cellIndex(f.x, f.y);
          if (i < 0 || fishStamp[i] === frame || sharkFlag[i]) continue;
          fishStamp[i] = frame;
          this.fishGlyph[i] = fishIndex % qingjing.length;
          this.fishEscapeHeading[i] = f.startledUntil > world.time ? Math.atan2(f.vy, f.vx) : NaN;
          const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
          const v = 0.3 + 0.4 * (f.depth - 0.55) / 0.45 + 0.3 * Math.max(glint, f.alarm);
          fishBuckets[clamp(Math.floor(v * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1)].push(i);
        }
      }
    }
    drawFish() {
      const { ctx, cw, ch, cols, fishBuckets } = this;
      const hanzi = this.mode === "hanzi";
      ctx.save();
      if (hanzi) ctx.font = `500 ${Math.round(cw * 0.98)}px OceanHanzi, sans-serif`;
      for (let b = 0; b < fishBuckets.length; b++) {
        const bucket = fishBuckets[b];
        if (!bucket.length) continue;
        ctx.fillStyle = this.fishStyles[b];
        for (const i of bucket) {
          const x = i % cols * cw + cw / 2;
          const y = (i / cols | 0) * ch + ch / 2 + 1;
          const heading = this.fishEscapeHeading[i];
          if (!Number.isNaN(heading)) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(heading);
            ctx.fillStyle = this.dark ? "#bbf3ff" : "#fff";
            ctx.fillText(">", hanzi ? cw * 0.64 : 0, 0);
            ctx.restore();
            if (!hanzi) continue;
          }
          ctx.fillText(hanzi ? qingjing[this.fishGlyph[i]] : "-", x, y);
        }
      }
      ctx.restore();
    }
    drawRipple(world) {
      const splash = world.splashState;
      if (!splash) return;
      const progress = (world.time - splash.startedAt) / 0.75;
      if (progress >= 1) return;
      const { ctx } = this;
      ctx.save();
      ctx.strokeStyle = this.dark ? "#aeeeff" : "#fff";
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.55 * (1 - progress);
      ctx.beginPath();
      ctx.arc(splash.x, splash.y, 14 + progress * splash.radius * 0.58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    drawHeat() {
      const { ctx, heat, cols, cw, ch } = this;
      for (let i = 0; i < heat.length; i++) {
        const h = heat[i];
        if (h < 0.08) continue;
        const col = i % cols;
        const row = i / cols | 0;
        ctx.fillStyle = h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
        ctx.fillText(h > 0.6 ? "*" : "\xB7", col * cw + cw / 2, row * ch + ch / 2 + 1);
      }
    }
    /**
     * Every cell's dot twinkles on its own clock, is modulated by slow
     * caustic light bands, and flares cyan where the wake field is strong.
     * Dots are bucketed by colour/alpha so each bucket is one fillStyle.
     */
    drawDots(t) {
      const { ctx, cols, rows, cw, ch, dotKind, dotPhase, dotFreq, energy, sharkFlag, sharkShadow, fishStamp, frameId } = this;
      ctx.save();
      if (this.dark) ctx.globalAlpha = 0.55;
      const { bucketOf, bucketOrder, bucketCounts } = this;
      const n = cols * rows;
      const SKIP = bucketCounts.length - 1;
      bucketCounts.fill(0);
      for (let i = 0; i < n; i++) {
        const e = energy[i];
        const kind = dotKind[i];
        if (sharkFlag[i] || fishStamp[i] === frameId || kind === 0 && e < 0.45) {
          bucketOf[i] = SKIP;
          continue;
        }
        let bucket;
        if (e > 0.45) {
          const level = clamp(Math.floor((e - 0.45) * 5), 0, ALPHA_LEVELS - 1);
          bucket = WAKE * ALPHA_LEVELS + level;
        } else {
          const col = i % cols;
          const row = i / cols | 0;
          const twinkle = 0.5 + 0.5 * Math.sin(t * dotFreq[i] + dotPhase[i]);
          const caustic = 0.85 + 0.15 * Math.sin(col * 0.11 + t * 0.35) * Math.sin(row * 0.17 - t * 0.27);
          let v = clamp((0.55 + 0.45 * twinkle) * caustic + e * 2, 0, 1);
          if (sharkShadow[i]) v *= 0.2;
          bucket = (kind - 1) * ALPHA_LEVELS + clamp(Math.floor(v * ALPHA_LEVELS), 0, ALPHA_LEVELS - 1);
        }
        bucketOf[i] = bucket;
        bucketCounts[bucket]++;
      }
      const starts = new Int32Array(bucketCounts.length);
      for (let b = 1; b < bucketCounts.length; b++) starts[b] = starts[b - 1] + bucketCounts[b - 1];
      const cursor = starts.slice();
      for (let i = 0; i < n; i++) {
        const b = bucketOf[i];
        if (b !== SKIP) bucketOrder[cursor[b]++] = i;
      }
      const small = Math.max(2, Math.round(cw * 0.19));
      const large = small + 1;
      for (let b = 0; b < SKIP; b++) {
        const count = bucketCounts[b];
        if (!count) continue;
        ctx.fillStyle = this.dotStyles[b];
        const size = b >= WAKE * ALPHA_LEVELS ? large : small;
        const start = starts[b];
        for (let k = start; k < start + count; k++) {
          const i = bucketOrder[k];
          const col = i % cols;
          const row = i / cols | 0;
          ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);
        }
      }
      ctx.restore();
    }
  };

  // src/engine.ts
  var STEP = 1 / 60;
  var MAX_STEPS = 4;
  var OceanEngine = class {
    constructor(canvas, sharks) {
      this.canvas = canvas;
      this.world = new World(sharks);
      this.renderer = new AsciiRenderer(canvas);
      this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.intersectionObserver = new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        this.schedule();
      });
      this.intersectionObserver.observe(canvas);
      this.reducedMotion.addEventListener("change", this.onMotionPreference);
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("blur", this.onPointerLeave);
      this.resize();
      document.fonts?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`).then(() => {
        if (!this.disposed && this.reducedMotion.matches) this.drawStill();
      });
      this.schedule();
    }
    world;
    renderer;
    raf = 0;
    last = 0;
    acc = 0;
    visible = true;
    reducedMotion;
    resizeObserver;
    intersectionObserver;
    disposed = false;
    paused = false;
    speed = 0.65;
    setPaused(paused2) {
      this.paused = paused2;
      cancelAnimationFrame(this.raf);
      if (!paused2) this.schedule();
    }
    setSpeed(speed2) {
      this.speed = speed2;
    }
    setRenderMode(mode) {
      this.renderer.setMode(mode);
      this.renderer.render(this.world, 0);
      if (mode === "hanzi") {
        document.fonts?.load("500 16px OceanHanzi").then(() => {
          if (!this.disposed) this.renderer.render(this.world, 0);
        });
      }
    }
    setTheme(theme2) {
      this.renderer.setTheme(theme2);
      this.renderer.render(this.world, 0);
    }
    setSharks(sharks) {
      this.world = new World(sharks);
      this.acc = 0;
      this.resize();
      for (let i = 0; i < 150; i++) this.world.step(STEP);
      this.renderer.render(this.world, STEP);
    }
    ripple(x, y) {
      this.world.splash(x, y);
      if (this.reducedMotion.matches && !this.paused) {
        for (let i = 0; i < 8; i++) this.world.step(STEP);
      }
      if (this.paused || this.reducedMotion.matches) this.renderer.render(this.world, STEP);
    }
    rippleNearSchool(panel) {
      const { width, height, fish } = this.world;
      const x = width * 0.5;
      const y = height * 0.72;
      let bestDistance = Infinity;
      let target;
      for (const f of fish) {
        if (!f.alive || f.x < 24 || f.x > width - 24 || f.y < 24 || f.y > height - 56) continue;
        if (panel && f.x > panel.left - 16 && f.x < panel.right + 16 && f.y > panel.top - 16 && f.y < panel.bottom + 16) continue;
        const distance = Math.hypot(f.x - x, f.y - y);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        target = f;
      }
      this.ripple(target?.x ?? x, target?.y ?? y);
    }
    destroy() {
      this.disposed = true;
      cancelAnimationFrame(this.raf);
      this.resizeObserver.disconnect();
      this.intersectionObserver.disconnect();
      this.reducedMotion.removeEventListener("change", this.onMotionPreference);
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerdown", this.onPointerDown);
      document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("blur", this.onPointerLeave);
    }
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.resize(rect.width, rect.height, dpr);
      this.world.resize(rect.width, rect.height, this.renderer.cellWidth, this.renderer.cellHeight);
      if (this.reducedMotion.matches) this.drawStill();
    }
    schedule() {
      cancelAnimationFrame(this.raf);
      if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches) return;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
    frame = (now) => {
      const dt = Math.min(0.1, (now - this.last) / 1e3);
      this.last = now;
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        this.world.step(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0;
      this.renderer.render(this.world, dt);
      this.raf = requestAnimationFrame(this.frame);
    };
    /** Reduced motion: let the ecosystem settle, then show a single frame. */
    drawStill() {
      if (this.world.time < 4) {
        for (let i = 0; i < 240; i++) this.world.step(STEP);
      }
      this.renderer.render(this.world, STEP);
    }
    onMotionPreference = () => {
      if (this.reducedMotion.matches) {
        cancelAnimationFrame(this.raf);
        this.drawStill();
      } else {
        this.schedule();
      }
    };
    toLocal(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      return { x, y, inside };
    }
    onPointerMove = (e) => {
      const { x, y, inside } = this.toLocal(e);
      const p = this.world.pointer;
      p.x = x;
      p.y = y;
      p.active = inside && e.pointerType !== "touch";
      p.movedAt = this.world.time;
    };
    onPointerDown = (e) => {
      if (e.button !== 0 || e.target instanceof Element && e.target.closest(".center-panel, .ocean-controls, .credit")) return;
      const { x, y, inside } = this.toLocal(e);
      if (inside) this.ripple(x, y);
    };
    onPointerLeave = () => {
      this.world.pointer.active = false;
    };
  };

  // src/themes.ts
  var themes = {
    light: { label: "Day", page: "#ffffff" },
    dark: { label: "Night", page: "#07111a" },
    deep: { label: "Deep Water", page: "#082b40" }
  };

  // src/app.ts
  var $ = (id) => document.getElementById(id);
  var icons = {
    pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>'
  };
  var mixed = [
    { kind: "whaleshark", size: 1 },
    { kind: "manta", size: 0.83 },
    { kind: "hammerhead", size: 0.86 },
    { kind: "sunfish", size: 0.64 },
    { kind: "classic", size: 0.78 }
  ];
  var kinds = ["manta", "whaleshark", "sunfish", "thresher", "mako", "nurse", "greathammer", "zebra", "tiger", "classic", "hammerhead"];
  var names = { manta: "Manta ray", whaleshark: "Whale shark", sunfish: "Sunfish", thresher: "Thresher shark", mako: "Mako shark", nurse: "Nurse shark", greathammer: "Great hammerhead", zebra: "Zebra shark", tiger: "Tiger shark", classic: "Classic shark", hammerhead: "Hammerhead" };
  var roster = mixed.map((s) => ({ ...s }));
  var paused = false;
  var themeModes = Object.keys(themes);
  var currentTheme = "deep";
  var statusTimer;
  var storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
  };
  function status(message) {
    const el = $("ocean-status");
    clearTimeout(statusTimer);
    el.textContent = message;
    el.classList.add("visible");
    statusTimer = setTimeout(() => el.classList.remove("visible"), 3400);
  }
  var pause = $("pause");
  var theme = $("theme");
  var themeSelect = $("water-theme");
  pause.innerHTML = icons.pause;
  var engine = new OceanEngine($("ocean"), roster);
  engine.setSharks(roster);
  var renderModes = ["braille", "geometry", "ascii", "hanzi"];
  var modeLabels = { ascii: "ASCII", braille: "DOTS", geometry: "GEO", hanzi: "HANZI" };
  var modeNames = { ascii: "ASCII", braille: "Braille dots", geometry: "Geometric shapes", hanzi: "Hanzi" };
  var modeDescriptions = {
    ascii: "Monospaced characters and shaded cells shape the fish.",
    braille: "Fine dots trace the fish silhouettes.",
    geometry: "Dots, rings, diamonds, and squares form the fish.",
    hanzi: "The fish are drawn with characters from the Classic of Clarity and Stillness."
  };
  var renderMode = "ascii";
  function applyRenderMode(mode) {
    renderMode = mode;
    engine.setRenderMode(mode);
    $("render-mode").value = mode;
    $("style-toggle").textContent = modeLabels[mode];
    $("style-toggle").setAttribute("aria-label", `Cycle character styles. Current style is ${modeNames[mode]}.`);
    $("style-toggle").title = `${modeNames[mode]} \xB7 Next style`;
    $("mode-description").textContent = modeDescriptions[mode];
    storage.set("ascii-ocean-render-mode", mode);
  }
  var savedMode = storage.get("ascii-ocean-render-mode");
  applyRenderMode(savedMode && renderModes.includes(savedMode) ? savedMode : "ascii");
  $("render-mode").addEventListener("change", (e) => applyRenderMode(e.target.value));
  $("style-toggle").addEventListener("click", () => applyRenderMode(renderModes[(renderModes.indexOf(renderMode) + 1) % renderModes.length]));
  pause.addEventListener("click", () => {
    paused = !paused;
    engine.setPaused(paused);
    pause.innerHTML = paused ? icons.play : icons.pause;
    pause.setAttribute("aria-label", paused ? "Resume animation" : "Pause animation");
    pause.setAttribute("aria-pressed", String(paused));
    pause.title = paused ? "Resume animation" : "Pause animation";
  });
  function applyTheme(value) {
    currentTheme = value;
    const { label, page } = themes[value];
    document.documentElement.dataset.theme = value;
    document.documentElement.style.setProperty("--page", page);
    engine.setTheme(value);
    themeSelect.value = value;
    theme.textContent = label;
    theme.setAttribute("aria-label", `Cycle water themes. Current theme is ${label}.`);
    theme.title = `${label} \xB7 Next water theme`;
    document.querySelector("meta[name=theme-color]")?.setAttribute("content", page);
  }
  var savedTheme = storage.get("ascii-ocean-theme");
  applyTheme(savedTheme && themeModes.includes(savedTheme) ? savedTheme : currentTheme);
  function changeTheme(value) {
    if (value === currentTheme) return;
    document.querySelectorAll(".ocean-theme-veil").forEach((el) => el.remove());
    let veil = null;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const canvas = $("ocean");
      const snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      const context = snapshot.getContext("2d");
      if (context && "filter" in context) {
        const appearance = getComputedStyle(canvas);
        context.fillStyle = getComputedStyle(document.body).backgroundColor;
        context.fillRect(0, 0, snapshot.width, snapshot.height);
        context.filter = appearance.filter;
        context.globalAlpha = Number(appearance.opacity);
        context.drawImage(canvas, 0, 0);
        snapshot.className = "ocean-theme-veil";
        snapshot.setAttribute("aria-hidden", "true");
        canvas.after(snapshot);
        veil = snapshot;
      }
    }
    applyTheme(value);
    storage.set("ascii-ocean-theme", value);
    if (veil) {
      const snapshot = veil;
      const fade = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 480,
        easing: "cubic-bezier(.2,.7,.2,1)",
        fill: "forwards"
      });
      fade.finished.catch(() => {
      }).finally(() => snapshot.remove());
      window.setTimeout(() => snapshot.remove(), 650);
    }
  }
  theme.addEventListener("click", () => changeTheme(themeModes[(themeModes.indexOf(currentTheme) + 1) % themeModes.length]));
  themeSelect.addEventListener("change", () => changeTheme(themeSelect.value));
  var settingsToggle = $("settings-toggle");
  var settingsPanel = $("settings-panel");
  function setSettingsOpen(open) {
    settingsPanel.hidden = !open;
    settingsToggle.setAttribute("aria-expanded", String(open));
  }
  settingsToggle.addEventListener("click", () => setSettingsOpen(settingsPanel.hidden));
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".ocean-controls")) setSettingsOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || settingsPanel.hidden) return;
    if (settingsPanel.contains(document.activeElement)) settingsToggle.focus();
    setSettingsOpen(false);
  });
  var speed = $("speed");
  speed.addEventListener("input", () => {
    engine.setSpeed(Number(speed.value));
    $("speed-value").textContent = `${Number(speed.value).toFixed(2)}\xD7`;
  });
  $("roster").addEventListener("change", (e) => {
    const kind = e.target.value;
    roster = kind === "mixed" ? mixed.map((s) => ({ ...s })) : [1, 0.87, 0.76, 0.68].map((size) => ({ kind, size }));
    engine.setSharks(roster);
  });
  $("add-shark").addEventListener("click", () => {
    if (roster.length >= 9) {
      status("The tank is full. Let the animals swim.");
      return;
    }
    const kind = kinds.find((kind2) => !roster.some((fish) => fish.kind === kind2)) ?? kinds[roster.length % kinds.length];
    roster.push({ kind, size: 0.64 + Math.random() * 0.15 });
    engine.setSharks(roster);
    status(`Now swimming \xB7 ${names[kind]}`);
  });
  $("ripple").addEventListener("click", () => {
    const panel = document.querySelector(".center-panel:not([hidden])");
    engine.rippleNearSchool(panel?.getBoundingClientRect());
    status("A ripple spreads across the water.");
  });
  var layouts = ["music", "focus"];
  var layoutNames = { music: "Music", focus: "Focus" };
  var headlines = { music: "take a little break.", focus: "one thing at a time." };
  var layout = "music";
  var tracks = [
    { title: "Somewhere, slowly", artist: "Late Tide", duration: 272 },
    { title: "Blue hour", artist: "Quiet Current", duration: 218 },
    { title: "A softer place", artist: "Still Water", duration: 305 }
  ];
  var trackIndex = 0;
  var trackPosition = 84;
  var trackStartedAt = 0;
  var playing = false;
  var trackSeek = $("track-seek");
  var trackPlay = $("track-play");
  var formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  function updateText(id, text) {
    if ($(id).textContent !== text) $(id).textContent = text;
  }
  function updatePlayButton(button, active, label) {
    if (!button.firstElementChild || button.getAttribute("aria-pressed") !== String(active)) button.innerHTML = active ? icons.pause : icons.play;
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  function playbackPosition() {
    return Math.min(tracks[trackIndex].duration, trackPosition + (playing ? (performance.now() - trackStartedAt) / 1e3 : 0));
  }
  function renderTrack() {
    const track = tracks[trackIndex];
    const position = playbackPosition();
    updateText("track-title", track.title);
    updateText("track-artist", track.artist);
    updateText("track-elapsed", formatTime(position));
    updateText("track-duration", formatTime(track.duration));
    trackSeek.max = String(track.duration);
    trackSeek.value = String(Math.floor(position));
    trackSeek.style.setProperty("--progress", `${position / track.duration * 100}%`);
    trackSeek.setAttribute("aria-valuetext", `${formatTime(position)} / ${formatTime(track.duration)}`);
    $("music-panel").classList.toggle("is-playing", playing);
    updatePlayButton(trackPlay, playing, playing ? "Pause playback demo" : "Play demo");
  }
  function setPlaying(value) {
    trackPosition = playbackPosition();
    if (value && trackPosition >= tracks[trackIndex].duration) trackPosition = 0;
    playing = value;
    trackStartedAt = performance.now();
    renderTrack();
  }
  function changeTrack(direction) {
    trackIndex = (trackIndex + direction + tracks.length) % tracks.length;
    trackPosition = 0;
    trackStartedAt = performance.now();
    renderTrack();
  }
  trackPlay.addEventListener("click", () => setPlaying(!playing));
  $("track-previous").addEventListener("click", () => changeTrack(-1));
  $("track-next").addEventListener("click", () => changeTrack(1));
  trackSeek.addEventListener("input", () => {
    trackPosition = Number(trackSeek.value);
    trackStartedAt = performance.now();
    renderTrack();
  });
  renderTrack();
  var focusDuration = 25 * 60;
  var focusRemaining = focusDuration;
  var focusEndsAt = 0;
  var focusing = false;
  var focusPlay = $("focus-play");
  var focusTask = $("focus-task");
  focusTask.value = storage.get("ascii-ocean-focus-task")?.slice(0, 100) || "Make something good.";
  focusTask.addEventListener("input", () => storage.set("ascii-ocean-focus-task", focusTask.value));
  function remainingFocus() {
    return focusing ? Math.max(0, (focusEndsAt - Date.now()) / 1e3) : focusRemaining;
  }
  function renderFocus() {
    updateText("focus-time", formatTime(Math.ceil(remainingFocus())).padStart(5, "0"));
    const label = focusing ? "Pause focus timer" : focusRemaining < focusDuration && focusRemaining > 0 ? "Resume focus timer" : "Start focus timer";
    updatePlayButton(focusPlay, focusing, label);
  }
  function setFocusing(value) {
    focusRemaining = remainingFocus();
    if (value && focusRemaining <= 0) focusRemaining = focusDuration;
    focusing = value;
    focusEndsAt = Date.now() + focusRemaining * 1e3;
    renderFocus();
  }
  focusPlay.addEventListener("click", () => setFocusing(!focusing));
  $("focus-reset").addEventListener("click", () => {
    focusing = false;
    focusRemaining = focusDuration;
    renderFocus();
  });
  renderFocus();
  function applyLayout(value, animate = true) {
    if (value !== "music" && playing) setPlaying(false);
    if (value !== "focus" && focusing) setFocusing(false);
    layout = value;
    setSettingsOpen(false);
    clearTimeout(statusTimer);
    $("ocean-status").classList.remove("visible");
    for (const name of layouts) $(`${name}-panel`).hidden = name !== value;
    $("hero-title").textContent = headlines[value];
    $("layout-label").textContent = layoutNames[value];
    const next = layouts[(layouts.indexOf(value) + 1) % layouts.length];
    const description = `Switch from ${layoutNames[value]} to ${layoutNames[next]}`;
    $("layout-toggle").setAttribute("aria-label", description);
    $("layout-toggle").title = `Switch to ${layoutNames[next]}`;
    document.querySelectorAll(".layout-dots i").forEach((dot, i) => dot.classList.toggle("active", i === layouts.indexOf(value)));
    storage.set("ascii-ocean-layout", value);
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const el of [$("hero-title"), ...layouts.map((name) => $(`${name}-panel`))]) el.getAnimations().forEach((animation) => animation.cancel());
      for (const el of [$("hero-title"), $(`${value}-panel`)]) el.animate([{ opacity: 0, translate: "0 5px" }, { opacity: 1, translate: "0 0" }], { duration: 230, easing: "ease-out" });
    }
  }
  var savedLayout = storage.get("ascii-ocean-layout");
  applyLayout(savedLayout && layouts.includes(savedLayout) ? savedLayout : "music", false);
  $("layout-toggle").addEventListener("click", () => applyLayout(layouts[(layouts.indexOf(layout) + 1) % layouts.length]));
  var demoTimer = window.setInterval(() => {
    if (playing) {
      if (playbackPosition() >= tracks[trackIndex].duration) changeTrack(1);
      else renderTrack();
    }
    if (focusing) {
      if (remainingFocus() <= 0) {
        setFocusing(false);
        status("Focus session complete. Take a break.");
        engine.ripple(window.innerWidth * 0.5, window.innerHeight * 0.6);
      } else renderFocus();
    }
  }, 250);
  window.addEventListener("pagehide", () => {
    window.clearInterval(demoTimer);
    engine.destroy();
  }, { once: true });
})();
