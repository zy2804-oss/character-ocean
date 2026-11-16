import { hash3 } from "./math";

// Values are relative to the viewport, so the shafts remain visible on narrow screens.
const shafts = [
  { origin: 0.42, drift: 0.23, spread: 0.11, strength: 0.16 },
  { origin: 0.54, drift: 0.30, spread: 0.08, strength: 0.25 },
  { origin: 0.64, drift: 0.34, spread: 0.16, strength: 0.30 },
  { origin: 0.75, drift: 0.29, spread: 0.08, strength: 0.22 },
  { origin: 0.83, drift: 0.23, spread: 0.12, strength: 0.18 },
];

const particles = Array.from({ length: 96 }, (_, i) => ({
  x: hash3(i, 2, 15),
  y: hash3(i, 3, 15),
  size: 0.45 + hash3(i, 4, 15) * 1.2,
  speed: 0.001 + hash3(i, 5, 15) * 0.003,
}));

/** Cache the light field behind the animals. The beam edges soften as they widen. */
export function paintDeepWater(ctx: CanvasRenderingContext2D, width: number, height: number) {
  if (!width || !height) return;
  const base = ctx.createLinearGradient(width * 0.65, 0, width * 0.2, height);
  base.addColorStop(0, "#0b5c7c");
  base.addColorStop(0.46, "#0a3c57");
  base.addColorStop(1, "#051e31");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.scale(width, height);
  const surface = ctx.createRadialGradient(0.66, -0.10, 0.02, 0.66, -0.10, 0.64);
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

/** Slow suspended particles become visible where they drift through the light. */
export function drawSuspendedParticles(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
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
