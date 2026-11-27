// Ridge Runner's flight model and game rules: an arcade bush plane with
// throttle, pitch and bank-to-turn, a stall, terrain collision, ten glowing
// rings to thread through the valley, and a landing on the strip to finish.
import { clamp, lerp, mulberry32 } from './random.js';
import { WORLD, heightAt, onRunway } from './terrain.js';

export const STEP = 1 / 60;
export const SCREEN_TITLE = 'title';
export const SCREEN_FLY = 'fly';
export const SCREEN_PAUSE = 'pause';
export const SCREEN_CRASH = 'crash';
export const SCREEN_DONE = 'done';

export const EVENT_NONE = 0;
export const EVENT_RING = 1;
export const EVENT_CRASH = 2;
export const EVENT_LANDED = 4;
export const EVENT_TAKEOFF = 8;

const MAX_SPEED = 96; // m/s at full throttle
const MIN_SPEED = 24; // m/s at idle
const STALL_SPEED = 30; // below this the wing stops flying
const RING_RADIUS = 30;
const RING_SCORE = 250;
const LANDING_SCORE = 500;

// The ring course: ten gates weaving down the valley and back to the strip.
export function buildRings(seed) {
  const rng = mulberry32(seed * 7919 + 13);
  const spots = [
    [60, 150, 420, 170],
    [-260, 210, 900, 200],
    [180, 260, 1380, 230],
    [-420, 300, 1860, 260],
    [120, 260, 2280, 210],
    [-380, 320, 1780, 240],
    [240, 280, 1240, 220],
    [-160, 220, 760, 190],
    [60, 160, 380, 160],
    [0, 110, 60, 130],
  ];
  return spots.map((s, i) => {
    // Each ring faces the way the course travels through it, so the pilot
    // meets it face-on: the direction from the previous gate (or the strip).
    const prev = i === 0 ? [0, WORLD.shelfHeight + 2.5, -170] : spots[i - 1];
    return {
      index: i,
      x: s[0] + (rng() - 0.5) * 24,
      y: s[1] + (rng() - 0.5) * 16,
      z: s[2],
      nextZ: s[3],
      passed: false,
      face: Math.atan2(s[0] - prev[0], s[2] - prev[2]),
    };
  });
}

export function freshPlane() {
  return {
    x: WORLD.runwayX,
    z: WORLD.runwayZ - WORLD.runwayLength / 2 + 40,
    y: WORLD.shelfHeight + 2.5,
    heading: 0, // north, down the runway
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    onGround: true,
    airborne: false,
  };
}

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.reset();
  }

  reset() {
    this.plane = freshPlane();
    this.rings = buildRings(this.seed);
    this.ringIndex = 0;
    this.score = 0;
    this.time = 0;
    this.screen = SCREEN_TITLE;
    this.message = '';
    this.messageUntil = 0;
    this.best = 0;
    this.landed = false;
    this.crashReason = '';
    this.events = EVENT_NONE;
    this.ringFlash = 0;
    this.propAngle = 0;
  }

  start() {
    this.reset();
    this.screen = SCREEN_FLY;
    this.message = 'FULL THROTTLE — ROTATE AT 35 KT';
    this.messageUntil = 5;
  }

  get nextRing() {
    return this.ringIndex < this.rings.length ? this.rings[this.ringIndex] : null;
  }

  get groundBelow() {
    return heightAt(this.plane.x, this.plane.z);
  }

  // One fixed step of the simulation. `input` is { pitch, roll, throttle } with
  // pitch/roll in [-1, 1] and throttle a delta in [-1, 1] per second. Returns an
  // event bitmask for sounds and the shot stager.
  step(dt, input) {
    this.events = EVENT_NONE;
    if (this.screen !== SCREEN_FLY) return this.events;
    const p = this.plane;
    this.time += dt;
    this.propAngle += dt * (4 + p.throttle * 26);

    // Throttle eases toward the lever; pitch and roll ease toward the stick.
    p.throttle = clamp(p.throttle + input.throttle * dt * 0.9, 0, 1);
    const pitchTarget = input.pitch * 0.42;
    const rollTarget = input.roll * 0.95;
    p.pitch += (pitchTarget - p.pitch) * Math.min(1, dt * 3.2);
    p.roll += (rollTarget - p.roll) * Math.min(1, dt * 3.6);

    // Speed chases the throttle, bleeding off in a climb and gaining in a dive.
    const targetSpeed = MIN_SPEED + p.throttle * (MAX_SPEED - MIN_SPEED);
    p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 0.55);
    p.speed += -Math.sin(p.pitch) * 22 * dt;
    p.speed = clamp(p.speed, 0, 118);

    // Bank turns the nose; lift holds the plane up while it has speed.
    p.heading += -Math.sin(p.roll) * 0.72 * dt * clamp(p.speed / 45, 0.25, 1);
    if (p.heading > Math.PI) p.heading -= Math.PI * 2;
    if (p.heading < -Math.PI) p.heading += Math.PI * 2;
    let climb = p.speed * Math.sin(p.pitch);
    if (p.speed < STALL_SPEED && !p.onGround) {
      climb -= (STALL_SPEED - p.speed) * 0.9; // the wing gives up: sink
    }
    const forward = p.speed * Math.cos(p.pitch);
    p.x += Math.sin(p.heading) * forward * dt;
    p.z += Math.cos(p.heading) * forward * dt;
    p.y += climb * dt;

    const ground = this.groundBelow;
    const clearance = p.y - ground;

    if (p.onGround) {
      p.y = ground + 2.5;
      if (p.speed > 26 && p.pitch > 0.1) {
        p.onGround = false;
        p.airborne = true;
        this.events |= EVENT_TAKEOFF;
        this.message = 'AIRBORNE — FLY THE RINGS';
        this.messageUntil = this.time + 4;
      }
    } else if (clearance <= 2.5) {
      // Touching down: a gentle, slow, runway-aligned arrival is a landing.
      const aligned = Math.abs(Math.sin(p.heading)) < 0.35 && Math.abs(p.pitch) < 0.22;
      if (onRunway(p.x, p.z) && p.speed < 46 && aligned) {
        p.onGround = true;
        p.y = ground + 2.5;
        p.pitch = 0;
        p.roll = 0;
        if (this.ringIndex >= this.rings.length && !this.landed) {
          this.landed = true;
          const timeBonus = Math.max(0, Math.round(1200 - this.time * 4));
          this.score += LANDING_SCORE + timeBonus;
          this.events |= EVENT_LANDED;
          this.screen = SCREEN_DONE;
          this.message = '';
        }
      } else {
        this.crash(p.speed > 55 ? 'TERRAIN STRIKE AT SPEED' : 'CLIPPED THE RIDGE');
        return this.events;
      }
    }

    // Ring gates: flying within the ring's circle scores.
    const ring = this.nextRing;
    if (ring && !p.onGround) {
      const dx = p.x - ring.x;
      const dy = p.y - ring.y;
      const dz = p.z - ring.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < RING_RADIUS) {
        ring.passed = true;
        this.ringIndex += 1;
        this.score += RING_SCORE;
        this.ringFlash = 1;
        this.events |= EVENT_RING;
        if (this.ringIndex >= this.rings.length) {
          this.message = 'ALL RINGS — LAND ON THE STRIP';
          this.messageUntil = this.time + 6;
        } else {
          this.message = `RING ${this.ringIndex} OF ${this.rings.length}`;
          this.messageUntil = this.time + 2.5;
        }
      }
    }
    if (this.ringFlash > 0) this.ringFlash = Math.max(0, this.ringFlash - dt * 2.2);
    if (this.message && this.time > this.messageUntil) this.message = '';
    // Keep the plane inside the valley bowl.
    if (Math.abs(p.x) > 3600 || Math.abs(p.z) > 3600) {
      this.crash('FLEW OUT OF THE VALLEY');
    }
    return this.events;
  }

  crash(reason) {
    this.crashReason = reason;
    this.screen = SCREEN_CRASH;
    this.events |= EVENT_CRASH;
  }
}

// Steer the plane toward the next ring (or the runway, once the course is
// done) with a simple proportional pilot, used to stage the screenshots.
// The throttle input is a lever rate, so the pilot aims the lever at a target
// setting instead of holding it open, and it slows down near each gate so the
// turn radius shrinks enough to thread the ring.
export function autopilot(world) {
  const p = world.plane;
  const landing = world.nextRing === null;
  let target;
  let wantPitch;
  let throttleTarget;
  if (landing) {
    // Land in two stages: first join the fix 900 m south of the strip, level
    // at 90 m, and turn onto the centreline; only once lined up heading
    // north does the pilot glide down the slope to the threshold. Separating
    // the turn from the descent keeps the final straight and slow.
    const aligned = Math.abs(p.heading) < 0.5 && Math.abs(p.x) < 250 && p.z < -100;
    const committed =
      p.z >= -100 && p.z < 400 && Math.abs(p.x) < 150 && Math.abs(p.heading) < 0.6;
    const onFinal = aligned || committed;
    if (onFinal) {
      // Aim at mid-runway so the heading target stays ahead of the plane
      // until it has settled, and put the slope's foot at the threshold (z=0)
      // so the wheels meet the strip before the target is ever passed. While
      // still south of the threshold, aim at the threshold itself so the
      // heading corrects onto the centreline instead of running parallel.
      target = { x: 0, y: WORLD.shelfHeight - 6, z: p.z < -50 ? 0 : 300 };
      const slopeY = WORLD.shelfHeight + 4 + Math.max(0, -p.z) * 0.16;
      const desiredY = p.z > 0 ? WORLD.shelfHeight - 6 : Math.min(slopeY, WORLD.shelfHeight + 70);
      wantPitch = clamp((desiredY - p.y) * 0.008, -0.28, 0.28);
      throttleTarget = p.onGround ? 0 : 0.12;
    } else {
      target = { x: 0, y: WORLD.shelfHeight + 70, z: -900 };
      wantPitch = clamp((target.y - p.y) * 0.006, -0.3, 0.3);
      // Slow for the turn onto final so the procedure turn stays tight and
      // the plane comes out near the centreline instead of far out to one side.
      throttleTarget = p.onGround ? 0 : 0.2;
    }
  } else {
    target = world.nextRing;
    const dy = target.y - p.y;
    wantPitch = clamp(dy * 0.006, -0.3, 0.3);
    const dist = Math.sqrt((target.x - p.x) ** 2 + (target.z - p.z) ** 2);
    throttleTarget = dist < 220 ? 0.5 : 0.78;
  }
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const wantHeading = Math.atan2(dx, dz);
  let dh = wantHeading - p.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  return {
    pitch: clamp(wantPitch / 0.42, -1, 1),
    // The -roll term damps the bank so the heading settles instead of swinging.
    roll: clamp(-dh * 1.8 - p.roll * 0.35, -1, 1),
    throttle: clamp((throttleTarget - p.throttle) * 3, -1, 1),
  };
}
