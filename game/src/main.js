// Ridge Runner's front end: the fixed-step game loop, the screen state
// machine, and the ?shot= scenes the screenshots are taken from. The world
// state is exposed as window.__ridgeRun so a play-test can read it.
import { EVENT_CRASH, EVENT_LANDED, EVENT_RING, EVENT_TAKEOFF, SCREEN_CRASH, SCREEN_DONE, SCREEN_FLY, SCREEN_PAUSE, SCREEN_TITLE, STEP, World } from './flight.js';
import { render } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') || '1') || 1;
const shotName = params.get('shot');

const world = new World(seed);
const input = createInput(canvas);
const audio = createAudio();
let simTime = 0;
let best = 0;
try {
  best = Number(window.localStorage.getItem('ridge-runner-best') || '0') || 0;
} catch {
  best = 0;
}
world.best = best;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function announce(text) {
  if (statusEl) statusEl.textContent = text;
}

function applyEvents(events) {
  if (events & EVENT_RING) audio.ring();
  if (events & EVENT_TAKEOFF) audio.takeoff();
  if (events & EVENT_LANDED) audio.land();
  if (events & EVENT_CRASH) audio.crash();
  if (events & EVENT_LANDED) {
    try {
      const prev = Number(window.localStorage.getItem('ridge-runner-best') || '0') || 0;
      if (world.score > prev) window.localStorage.setItem('ridge-runner-best', String(world.score));
    } catch {
      // Storage may be unavailable; the score still shows on screen.
    }
  }
}

input.onKeyPress = (key, down) => {
  if (!down) return;
  audio.unlock();
  if (key === 'Enter' && world.screen === SCREEN_TITLE) {
    world.start();
    announce('Ridge Runner: flying. Thread the rings, then land on the strip.');
  } else if (key === 'r' && (world.screen === SCREEN_CRASH || world.screen === SCREEN_DONE)) {
    world.start();
  } else if (key === 'r' && world.screen === SCREEN_FLY) {
    world.start();
  } else if (key === 'p' && world.screen === SCREEN_FLY) {
    world.screen = SCREEN_PAUSE;
  } else if (key === 'p' && world.screen === SCREEN_PAUSE) {
    world.screen = SCREEN_FLY;
  } else if (key === 'm') {
    const muted = audio.toggleMute();
    world.message = muted ? 'SOUND OFF' : 'SOUND ON';
    world.messageUntil = world.time + 2;
  }
};

canvas.addEventListener('mousedown', () => audio.unlock());

window.__ridgeRun = { world, input: input.input };

if (shotName) {
  // Screenshot mode: stage the scene deterministically and render one frame.
  const staged = stageShot(shotName, world);
  simTime = staged.time;
  render(ctx, world, { width: canvas.width, height: canvas.height, time: simTime });
  document.title = `Ridge Runner — ${shotName}`;
} else {
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (world.screen === SCREEN_FLY) {
      acc += dt;
      while (acc >= STEP) {
        input.poll();
        const events = world.step(STEP, input.input);
        applyEvents(events);
        simTime += STEP;
        acc -= STEP;
      }
      audio.update(world.plane.throttle, world.plane.speed, true);
    } else {
      audio.update(0, 0, false);
    }
    render(ctx, world, { width: canvas.width, height: canvas.height, time: simTime });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
