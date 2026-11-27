// The valley Ridge Runner flies over: rolling green hills, a river winding
// down the middle, rice terraces on its banks, and the great cone of Mount
// Merapi watching from the north-west. Heights are in metres; the airstrip
// sits on a flattened shelf at the valley's south end.
import { clamp, fbm, lerp, noise2 } from './random.js';

export const WORLD = {
  seed: 1,
  // The volcano's summit, in world metres (x east, z north).
  volcanoX: -1500,
  volcanoZ: -2100,
  volcanoHeight: 980,
  volcanoRadius: 1500,
  // The airstrip: a flat shelf the runway sits on.
  runwayX: 0,
  runwayZ: 0,
  runwayHeading: 0, // runway runs north-south
  runwayLength: 420,
  runwayWidth: 26,
  shelfHeight: 46,
  // The river snakes south-east to north-west through the valley floor.
  riverBaseX: 420,
};

function ridgeNoise(x, z, seed) {
  // Broad hills with a sharper ridge line on top, so the skyline reads.
  const broad = fbm(x / 900, z / 900, seed, 4);
  const sharp = fbm(x / 260 + 7.3, z / 260 + 2.1, seed + 55, 3);
  return broad * 95 + Math.max(0, sharp) * 70;
}

function volcanoHeight(x, z) {
  const dx = x - WORLD.volcanoX;
  const dz = z - WORLD.volcanoZ;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= WORLD.volcanoRadius) return 0;
  const t = 1 - d / WORLD.volcanoRadius;
  // A cone with a cratered top and rocky flanks.
  const cone = Math.pow(t, 1.6) * WORLD.volcanoHeight;
  const crater = d < 170 ? (170 - d) * 1.1 : 0;
  const flank = noise2(x / 180, z / 180, 7) * 26 * t;
  return Math.max(0, cone - crater + flank);
}

function riverDistance(x, z) {
  // Distance from the river's centre line, which meanders as it runs north.
  const centre = WORLD.riverBaseX + Math.sin(z / 640) * 260 + Math.sin(z / 173) * 60;
  return Math.abs(x - centre);
}

// Height of the ground at a world point, in metres.
export function heightAt(x, z) {
  let h = 60 + ridgeNoise(x, z, WORLD.seed);
  h += volcanoHeight(x, z);
  // Carve the river valley down toward the water.
  const rd = riverDistance(x, z);
  const carve = Math.max(0, 1 - rd / 320);
  h = lerp(h, 34, carve * carve * 0.85);
  // Flatten a shelf for the airstrip so takeoffs and landings are fair.
  const dx = Math.abs(x - WORLD.runwayX);
  const dz = Math.abs(z - WORLD.runwayZ);
  const onShelfX = clamp(1 - (dx - WORLD.runwayWidth / 2 - 30) / 140, 0, 1);
  const onShelfZ = clamp(1 - (dz - WORLD.runwayLength / 2 - 30) / 140, 0, 1);
  const shelf = onShelfX * onShelfZ;
  if (shelf > 0) h = lerp(h, WORLD.shelfHeight, shelf);
  return h;
}

// Is this point on the runway strip itself (for landing, not just the shelf)?
export function onRunway(x, z) {
  return (
    Math.abs(x - WORLD.runwayX) <= WORLD.runwayWidth / 2 &&
    Math.abs(z - WORLD.runwayZ) <= WORLD.runwayLength / 2
  );
}

// Ground colour at a point, as [r, g, b], before light and fog.
export function groundColor(x, z, h) {
  const rd = riverDistance(x, z);
  // Water in the river bed.
  if (rd < 26 && h < 52) return [58, 122, 158];
  if (rd < 40 && h < 56) return [150, 148, 110];
  // Rice terraces: pale green stripes on the gentle slopes near the river.
  if (rd < 420 && h < 150) {
    const band = Math.floor(h / 7) % 2 === 0;
    return band ? [126, 168, 92] : [104, 148, 78];
  }
  if (h > 620) return [232, 236, 242]; // snow on the summit
  if (h > 420) return [122, 108, 96]; // bare rock
  if (h > 300) return [96, 110, 70]; // high scrub
  if (h > 170) return [74, 122, 62]; // forest
  // Valley grass, with a little texture from a broad noise field so neighbouring
  // patches blend instead of checkerboarding.
  const n = noise2(x / 420, z / 420, 31) * 10;
  return [86 + n, 146 + n, 74 + n * 0.5];
}
