// The staged scenes behind ?shot=start|play|ring|end. Each one flies the real
// rules forward from a fresh world for a fixed number of steps, steered by the
// autopilot, so the frame is what a real flight looks like and the same seed
// always gives the same frame. The end scene's pilot is given a long leash to
// finish the course and land; if it has not touched down by then, the shot is
// staged on the strip after a full course, which the rules still render.
import { EVENT_LANDED, SCREEN_DONE, SCREEN_FLY, SCREEN_TITLE, STEP, autopilot } from './flight.js';

const SAMPLE_SECONDS = {
  start: 0,
  play: 34,
  ring: 52,
  end: 400,
};

function flyFor(world, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const events = world.step(STEP, autopilot(world));
    if (events & EVENT_LANDED) return true;
    if (world.screen !== SCREEN_FLY) return false;
  }
  return world.screen === SCREEN_DONE;
}

// Fly until the plane is closing on the next gate, so the frame catches the
// ring ahead of the nose instead of the sky just after one was passed.
function flyToRing(world, ringCount, maxSeconds) {
  const steps = Math.round(maxSeconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    world.step(STEP, autopilot(world));
    if (world.screen !== SCREEN_FLY) return false;
    if (world.ringIndex === ringCount && world.nextRing) {
      const p = world.plane;
      const r = world.nextRing;
      const d = Math.hypot(p.x - r.x, p.y - r.y, p.z - r.z);
      if (d < 200) return true;
    }
  }
  return false;
}

// Set `world` to the named scene and return the screen to draw over it.
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'ring' && name !== 'end') {
    world.screen = SCREEN_TITLE;
    // Let the title's valley settle: a few seconds of still air behind the plane.
    return { screen: SCREEN_TITLE, time: 6 };
  }
  world.start();
  if (name === 'ring') {
    flyToRing(world, 5, 120);
    return { screen: SCREEN_FLY, time: world.time };
  }
  if (name === 'end') {
    const landed = flyFor(world, SAMPLE_SECONDS.end);
    if (!landed) {
      // The pilot ran out of time mid-course: place the plane on the strip
      // after a completed course, the state the rules would show at the end.
      world.rings.forEach((r) => {
        r.passed = true;
      });
      world.ringIndex = world.rings.length;
      world.score += world.rings.length * 250 + 500;
      world.plane.x = 0;
      world.plane.z = -60;
      world.plane.y = 48.5;
      world.plane.heading = 0;
      world.plane.pitch = 0;
      world.plane.roll = 0;
      world.plane.speed = 0;
      world.plane.throttle = 0;
      world.plane.onGround = true;
      world.screen = SCREEN_DONE;
      world.time = 238;
    }
    return { screen: SCREEN_DONE, time: world.time };
  }
  flyFor(world, SAMPLE_SECONDS[name]);
  return { screen: SCREEN_FLY, time: world.time };
}
