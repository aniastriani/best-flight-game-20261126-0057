// Ridge Runner's renderer: a canvas 2D pseudo-3D chase view. The valley is a
// heightfield sampled on a grid in camera space and drawn far-to-near as
// shaded quads; the rings, the plane, the sky and the instruments are drawn
// on top. Everything is deterministic for a given world state and time.
import { clamp, lerp } from './random.js';
import { SCREEN_CRASH, SCREEN_DONE, SCREEN_FLY, SCREEN_PAUSE, SCREEN_TITLE } from './flight.js';
import { WORLD, groundColor, heightAt } from './terrain.js';

const SKY_TOP = [38, 98, 164];
const SKY_HORIZON = [207, 226, 236];
const FOG = [198, 214, 228];

function mix(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function css(c, alpha = 1) {
  const r = Math.round(clamp(c[0], 0, 255));
  const g = Math.round(clamp(c[1], 0, 255));
  const b = Math.round(clamp(c[2], 0, 255));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

function makeCamera(plane, width, height) {
  const fx = Math.sin(plane.heading);
  const fz = Math.cos(plane.heading);
  // On the ground the camera pulls back and rises a little, so the strip, the
  // plane and the valley ahead all read instead of a wall of near grass.
  const back = plane.onGround ? 27 : 17;
  const up = plane.onGround ? 9.5 : 4.6;
  const groundPitch = plane.onGround ? -0.07 : 0;
  return {
    x: plane.x - fx * back,
    y: plane.y + up,
    z: plane.z - fz * back,
    fx,
    fz,
    rx: fz,
    rz: -fx,
    pitch: plane.pitch * 0.55 + groundPitch,
    focal: height * 1.05,
    cx: width / 2,
    cy: height * 0.46,
  };
}

function project(cam, x, y, z) {
  const dx = x - cam.x;
  const dy = y - cam.y;
  const dz = z - cam.z;
  const fwd = dx * cam.fx + dz * cam.fz;
  const right = dx * cam.rx + dz * cam.rz;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const fwd2 = fwd * cp + dy * sp;
  const up2 = dy * cp - fwd * sp;
  if (fwd2 < 2) return null;
  return { x: cam.cx + (right * cam.focal) / fwd2, y: cam.cy - (up2 * cam.focal) / fwd2, d: fwd2 };
}

function drawSky(ctx, w, h, cam) {
  // Haze colour over the whole frame first, so any gap past the terrain's far
  // edge reads as haze, never as a black band.
  ctx.fillStyle = css(SKY_HORIZON);
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  g.addColorStop(0, css(SKY_TOP));
  g.addColorStop(1, css(SKY_HORIZON));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h * 0.62 + 2);
  // Haze band hugging the horizon.
  const hz = ctx.createLinearGradient(0, h * 0.42, 0, h * 0.62);
  hz.addColorStop(0, 'rgba(207,226,236,0)');
  hz.addColorStop(1, 'rgba(207,226,236,0.85)');
  ctx.fillStyle = hz;
  ctx.fillRect(0, h * 0.42, w, h * 0.2);
  // The sun, fixed in the west so the light stays put between screenshots.
  const sun = project(cam, cam.x - 2600, 900, cam.z + 1800);
  if (sun) {
    const sg = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 90);
    sg.addColorStop(0, 'rgba(255,244,200,0.95)');
    sg.addColorStop(0.25, 'rgba(255,226,150,0.55)');
    sg.addColorStop(1, 'rgba(255,226,150,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff7d6';
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 22, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A few seeded clouds drifting slowly east, drawn as soft white blobs.
const CLOUDS = [];
for (let i = 0; i < 16; i += 1) {
  const a = (i * 2.39996) % (Math.PI * 2);
  CLOUDS.push({
    x: Math.sin(a) * 2400 + Math.sin(i * 7.7) * 500,
    z: Math.cos(a) * 2400 - 400,
    y: 620 + ((i * 137) % 260),
    s: 90 + ((i * 53) % 120),
  });
}

function drawClouds(ctx, cam, time) {
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (const c of CLOUDS) {
    const cx = c.x + time * 2.2; // slow drift, deterministic in sim time
    const p = project(cam, cx, c.y, c.z);
    if (!p || p.d > 2600) continue;
    const s = (c.s * cam.focal) / p.d;
    if (s < 4) continue;
    ctx.globalAlpha = clamp(1.1 - p.d / 2400, 0.15, 0.9);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, s, s * 0.34, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x - s * 0.55, p.y + s * 0.08, s * 0.6, s * 0.26, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x + s * 0.55, p.y + s * 0.08, s * 0.6, s * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const ROWS = 34;
const COLS = 40;

function drawTerrain(ctx, cam, w, h) {
  // Sample the heightfield on a grid in camera space: rows march forward with
  // growing steps, columns fan out sideways, so near ground is dense and far
  // ground is cheap. Quads are painted far-to-near, which is the painter's
  // order for a heightfield seen from above.
  const grid = [];
  for (let r = 0; r < ROWS; r += 1) {
    const fwd = 16 * Math.pow(1.16, r);
    const row = [];
    for (let c = 0; c < COLS; c += 1) {
      const u = (c / (COLS - 1)) * 2 - 1;
      const lat = u * fwd * 0.82;
      const wx = cam.x + cam.fx * fwd + cam.rx * lat;
      const wz = cam.z + cam.fz * fwd + cam.rz * lat;
      const gy = heightAt(wx, wz);
      row.push({ p: project(cam, wx, gy, wz), x: wx, z: wz, y: gy, fwd });
    }
    grid.push(row);
  }
  for (let r = ROWS - 2; r >= 0; r -= 1) {
    for (let c = 0; c < COLS - 1; c += 1) {
      const a = grid[r][c];
      const b = grid[r][c + 1];
      const d = grid[r + 1][c + 1];
      const e = grid[r + 1][c];
      if (!a.p || !b.p || !d.p || !e.p) continue;
      const mx = (a.x + d.x) / 2;
      const mz = (a.z + d.z) / 2;
      const mh = (a.y + d.y) / 2;
      let col = groundColor(mx, mz, mh);
      // Gentle slope shading: faces tilted away from the sun go darker, kept
      // subtle so neighbouring quads do not stripe.
      const slope = (d.y - a.y) / Math.max(1, d.fwd - a.fwd);
      const shade = clamp(1 - slope * 0.8, 0.9, 1.05);
      col = [col[0] * shade, col[1] * shade, col[2] * shade];
      const fogT = clamp((a.fwd - 250) / 1100, 0, 0.78);
      col = mix(col, FOG, fogT);
      ctx.fillStyle = css(col);
      // Each quad is drawn a hair larger than its corners so antialiasing
      // never leaves a seam between neighbours.
      const pts = [a.p, b.p, d.p, e.p];
      const qx = (a.p.x + b.p.x + d.p.x + e.p.x) / 4;
      const qy = (a.p.y + b.p.y + d.p.y + e.p.y) / 4;
      ctx.beginPath();
      pts.forEach((pt, i) => {
        const ex = pt.x + (pt.x - qx) * 0.004 + Math.sign(pt.x - qx) * 0.6;
        const ey = pt.y + (pt.y - qy) * 0.004 + Math.sign(pt.y - qy) * 0.6;
        if (i === 0) ctx.moveTo(ex, ey);
        else ctx.lineTo(ex, ey);
      });
      ctx.closePath();
      ctx.fill();
    }
  }
  // The volcano's smoke plume, a grey column over the summit.
  const plume = project(cam, WORLD.volcanoX, WORLD.volcanoHeight + 260, WORLD.volcanoZ);
  if (plume && plume.d < 4000) {
    const s = (120 * cam.focal) / plume.d;
    ctx.fillStyle = 'rgba(200,198,190,0.5)';
    ctx.beginPath();
    ctx.ellipse(plume.x, plume.y - s * 0.4, s * 0.5, s * 0.9, 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRunway(ctx, cam) {
  // The strip is painted as short segments along its length, each tested on
  // its own, so the part behind the camera never hides the part ahead of it.
  const hw = WORLD.runwayWidth / 2;
  const hl = WORLD.runwayLength / 2;
  const y = WORLD.shelfHeight + 0.6;
  const seg = (x0, z0, x1, z1, fill) => {
    const a = project(cam, x0, y, z0);
    const b = project(cam, x1, y, z0);
    const d = project(cam, x1, y, z1);
    const e = project(cam, x0, y, z1);
    if (!a || !b || !d || !e) return;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(d.x, d.y);
    ctx.lineTo(e.x, e.y);
    ctx.closePath();
    ctx.fill();
  };
  for (let z = WORLD.runwayZ - hl; z < WORLD.runwayZ + hl; z += 14) {
    seg(WORLD.runwayX - hw, z, WORLD.runwayX + hw, z + 14, '#3c4148');
  }
  // Centreline dashes.
  for (let z = WORLD.runwayZ - hl + 24; z < WORLD.runwayZ + hl - 12; z += 28) {
    seg(WORLD.runwayX - 1.1, z, WORLD.runwayX + 1.1, z + 13, 'rgba(255,255,255,0.85)');
  }
  // Threshold bars at both ends.
  for (const z0 of [WORLD.runwayZ - hl + 6, WORLD.runwayZ + hl - 14]) {
    seg(WORLD.runwayX - hw + 2, z0, WORLD.runwayX + hw - 2, z0 + 8, 'rgba(255,255,255,0.8)');
  }
}

function drawRings(ctx, cam, world) {
  for (const ring of world.rings) {
    const p = project(cam, ring.x, ring.y, ring.z);
    if (!p || p.d > 1500) continue;
    const r = (30 * cam.focal) / p.d;
    if (r < 2) continue;
    const next = world.nextRing === ring;
    const upcoming = !ring.passed && !next;
    const colour = ring.passed ? '#7fd67f' : next ? '#ffd34d' : '#6fd7ff';
    const alpha = ring.passed ? 0.35 : next ? 1 : 0.6;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.shadowColor = colour;
    ctx.shadowBlur = next ? 22 : 8;
    // Each ring faces the course, so it reads as a circle when the plane
    // meets it head-on and flattens when seen from the side.
    const faceOn = Math.abs(Math.cos(world.plane.heading - ring.face));
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * Math.max(0.3, faceOn), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // A small beacon light on the ring's crown.
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y - r, Math.max(2, r * 0.08), 0, Math.PI * 2);
    ctx.fill();
    if (next && world.screen !== SCREEN_TITLE) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(11, Math.round(r * 0.22))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`RING ${ring.index + 1}`, p.x, p.y - r - Math.max(8, r * 0.12));
    }
    ctx.globalAlpha = 1;
  }
}

// The Cendrawasih, drawn from behind and slightly above: cream fuselage with
// a red cheatline, red wings with cream tips, red tail. Rotated by the bank.
// `dy` drops the sprite lower on title screens so it clears the text.
function drawPlane(ctx, w, h, world, time, dy = 0) {
  const p = world.plane;
  const cx = w / 2;
  const cy = h * 0.52 + dy;
  const s = h / 720;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.roll * 0.9);
  ctx.scale(s, s);
  // Main wings.
  ctx.fillStyle = '#c23b2e';
  ctx.beginPath();
  ctx.moveTo(-128, -6);
  ctx.quadraticCurveTo(-70, -22, -16, -14);
  ctx.lineTo(16, -14);
  ctx.quadraticCurveTo(70, -22, 128, -6);
  ctx.lineTo(122, 8);
  ctx.quadraticCurveTo(60, 2, 0, 6);
  ctx.quadraticCurveTo(-60, 2, -122, 8);
  ctx.closePath();
  ctx.fill();
  // Cream wingtips.
  ctx.fillStyle = '#f3e9d2';
  ctx.beginPath();
  ctx.moveTo(-128, -6);
  ctx.lineTo(-102, -13);
  ctx.lineTo(-100, 4);
  ctx.lineTo(-122, 8);
  ctx.closePath();
  ctx.moveTo(128, -6);
  ctx.lineTo(102, -13);
  ctx.lineTo(100, 4);
  ctx.lineTo(122, 8);
  ctx.closePath();
  ctx.fill();
  // Fuselage, nose at the top of the sprite, tail at the bottom.
  const body = ctx.createLinearGradient(-18, 0, 18, 0);
  body.addColorStop(0, '#d9c9a8');
  body.addColorStop(0.5, '#f7efdc');
  body.addColorStop(1, '#d9c9a8');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -84);
  ctx.quadraticCurveTo(15, -70, 17, -30);
  ctx.lineTo(19, 30);
  ctx.quadraticCurveTo(19, 52, 12, 58);
  ctx.lineTo(-12, 58);
  ctx.quadraticCurveTo(-19, 52, -19, 30);
  ctx.lineTo(-17, -30);
  ctx.quadraticCurveTo(-15, -70, 0, -84);
  ctx.closePath();
  ctx.fill();
  // Red cheatline down the fuselage.
  ctx.fillStyle = '#c23b2e';
  ctx.beginPath();
  ctx.moveTo(-17, -18);
  ctx.lineTo(17, -18);
  ctx.lineTo(18, -8);
  ctx.lineTo(-18, -8);
  ctx.closePath();
  ctx.fill();
  // Cockpit windows.
  ctx.fillStyle = '#1d2f45';
  ctx.beginPath();
  ctx.ellipse(0, -52, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tailplane and fin.
  ctx.fillStyle = '#c23b2e';
  ctx.beginPath();
  ctx.moveTo(-46, 44);
  ctx.lineTo(46, 44);
  ctx.lineTo(40, 56);
  ctx.lineTo(-40, 56);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 58);
  ctx.lineTo(13, 30);
  ctx.lineTo(13, 58);
  ctx.closePath();
  ctx.fill();
  // Registration on the tail.
  ctx.fillStyle = '#f3e9d2';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PK-RUN', 0, 52);
  // Propeller disc, a faint spinning blur at the nose.
  ctx.strokeStyle = 'rgba(40,40,40,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, -84, 26, 7, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function text(ctx, str, x, y, font, colour, align = 'left') {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(str, x + 1, y + 1);
  ctx.fillStyle = colour;
  ctx.fillText(str, x, y);
}

function drawHud(ctx, w, h, world) {
  const p = world.plane;
  const kt = Math.round(p.speed * 1.944);
  const altFt = Math.round(p.y * 3.281);
  const hdg = Math.round(((p.heading * 180) / Math.PI) % 360 + 360) % 360;
  const vsi = Math.round(p.speed * Math.sin(p.pitch) * 196.85);
  // Top-left flight data.
  ctx.textAlign = 'left';
  text(ctx, `SPD ${kt} KT`, 18, 34, 'bold 22px monospace', '#fff');
  text(ctx, `ALT ${altFt.toLocaleString('en-US')} FT`, 18, 62, 'bold 22px monospace', '#fff');
  text(ctx, `VSI ${vsi >= 0 ? '+' : ''}${vsi} FPM`, 18, 86, '16px monospace', '#cfe3ee');
  text(ctx, `HDG ${String(hdg).padStart(3, '0')}°`, 18, 110, '16px monospace', '#cfe3ee');
  // Compass tape across the top.
  const tapeW = 420;
  const tapeX = w / 2 - tapeW / 2;
  ctx.fillStyle = 'rgba(10,20,30,0.45)';
  ctx.fillRect(tapeX, 10, tapeW, 30);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(tapeX, 10, tapeW, 30);
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let d = -60; d <= 60; d += 5) {
    const deg = ((hdg + d) % 360 + 360) % 360;
    const x = w / 2 + (d / 60) * (tapeW / 2);
    const major = deg % 15 === 0;
    ctx.strokeStyle = major ? '#fff' : 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(x, 12);
    ctx.lineTo(x, major ? 26 : 20);
    ctx.stroke();
    if (names[deg] !== undefined || deg % 45 === 0) {
      text(ctx, names[deg] ?? String(deg), x, 38, 'bold 11px sans-serif', '#fff', 'center');
    }
  }
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 7, 40);
  ctx.lineTo(w / 2 + 7, 40);
  ctx.lineTo(w / 2, 48);
  ctx.closePath();
  ctx.fill();
  // Top-right: course progress.
  text(ctx, `RINGS ${world.ringIndex}/${world.rings.length}`, w - 18, 34, 'bold 22px monospace', '#fff', 'right');
  text(ctx, `SCORE ${world.score}`, w - 18, 62, 'bold 18px monospace', '#ffd34d', 'right');
  const mins = Math.floor(world.time / 60);
  const secs = Math.floor(world.time % 60);
  text(ctx, `TIME ${mins}:${String(secs).padStart(2, '0')}`, w - 18, 86, '16px monospace', '#cfe3ee', 'right');
  // Throttle lever on the left edge.
  ctx.fillStyle = 'rgba(10,20,30,0.45)';
  ctx.fillRect(16, h * 0.32, 14, h * 0.36);
  ctx.fillStyle = '#37b24d';
  const th = h * 0.36 * p.throttle;
  ctx.fillRect(16, h * 0.32 + h * 0.36 - th, 14, th);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(16, h * 0.32, 14, h * 0.36);
  text(ctx, 'THR', 23, h * 0.32 - 8, 'bold 11px sans-serif', '#fff', 'center');
  // Centre message.
  if (world.message) {
    text(ctx, world.message, w / 2, h * 0.24, 'bold 26px sans-serif', '#ffd34d', 'center');
  }
  // Terrain warning.
  const clearance = p.y - heightAt(p.x, p.z);
  if (world.screen === SCREEN_FLY && !p.onGround && clearance < 30) {
    const blink = Math.floor(world.time * 4) % 2 === 0;
    if (blink) text(ctx, '⚠ PULL UP — TERRAIN', w / 2, h * 0.32, 'bold 30px sans-serif', '#ff5a4d', 'center');
  }
  // Ring flash: a gold wash when a gate is scored.
  if (world.ringFlash > 0) {
    ctx.fillStyle = `rgba(255,211,77,${world.ringFlash * 0.16})`;
    ctx.fillRect(0, 0, w, h);
  }
  // Reticle.
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.52, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2 - 22, h * 0.52);
  ctx.lineTo(w / 2 - 8, h * 0.52);
  ctx.moveTo(w / 2 + 8, h * 0.52);
  ctx.lineTo(w / 2 + 22, h * 0.52);
  ctx.moveTo(w / 2, h * 0.52 - 22);
  ctx.lineTo(w / 2, h * 0.52 - 8);
  ctx.moveTo(w / 2, h * 0.52 + 8);
  ctx.lineTo(w / 2, h * 0.52 + 22);
  ctx.stroke();
}

function drawGauge(ctx, x, y, r, drawFace, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(8,16,24,0.72)';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8fa8bd';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
  ctx.clip();
  drawFace(r);
  ctx.restore();
  ctx.fillStyle = '#cfe3ee';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y + r + 13);
}

function drawDashboard(ctx, w, h, world) {
  const p = world.plane;
  const panelY = h - 108;
  ctx.fillStyle = 'rgba(10,18,26,0.55)';
  ctx.fillRect(0, panelY, w, 108);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, panelY, w, 1);
  const cy = panelY + 48;
  // Attitude indicator: sky and earth split by pitch, rolled by bank.
  drawGauge(ctx, w * 0.3, cy, 38, (r) => {
    ctx.save();
    ctx.rotate(-p.roll);
    ctx.translate(0, p.pitch * r * 1.4);
    ctx.fillStyle = '#3f8fd2';
    ctx.fillRect(-r, -r * 2, r * 2, r * 2);
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(-r, 0, r * 2, r * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 7);
    ctx.stroke();
  }, 'ATTITUDE');
  // Altimeter dial.
  drawGauge(ctx, w * 0.42, cy, 38, (r) => {
    const altFt = p.y * 3.281;
    const needle = ((altFt % 1000) / 1000) * Math.PI * 2;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8));
      ctx.lineTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(needle - Math.PI / 2) * (r - 10), Math.sin(needle - Math.PI / 2) * (r - 10));
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(altFt / 100)}`, 0, 14);
  }, 'ALTIMETER');
  // Airspeed dial.
  drawGauge(ctx, w * 0.54, cy, 38, (r) => {
    const kt = p.speed * 1.944;
    const needle = clamp(kt / 220, 0, 1) * Math.PI * 1.5 - Math.PI * 0.75 - Math.PI / 2;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 10; i += 1) {
      const a = (i / 10) * Math.PI * 1.5 - Math.PI * 0.75 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8));
      ctx.lineTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
      ctx.stroke();
    }
    ctx.strokeStyle = '#37b24d';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(needle) * (r - 10), Math.sin(needle) * (r - 10));
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(kt)}`, 0, 14);
  }, 'AIRSPEED');
  // Compass rose.
  drawGauge(ctx, w * 0.66, cy, 38, (r) => {
    ctx.save();
    ctx.rotate(-p.heading);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -r + 14);
    ctx.fillText('E', r - 10, 4);
    ctx.fillText('S', 0, r - 6);
    ctx.fillText('W', -r + 10, 4);
    ctx.restore();
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(0, -r + 4);
    ctx.lineTo(-5, -r + 12);
    ctx.lineTo(5, -r + 12);
    ctx.closePath();
    ctx.fill();
  }, 'HEADING');
  // Lit warning lamps.
  const lamps = [
    ['STALL', p.speed < 32 && !p.onGround, '#ff5a4d'],
    ['GEAR', p.onGround, '#37b24d'],
    ['RING', world.ringFlash > 0.3, '#ffd34d'],
  ];
  lamps.forEach((lamp, i) => {
    const x = w * 0.78 + i * 54;
    ctx.fillStyle = lamp[1] ? lamp[2] : 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(x, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cfe3ee';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lamp[0], x, cy + 24);
  });
}

function overlay(ctx, w, h, title, lines, accent, titleY = 0.36) {
  ctx.fillStyle = 'rgba(6,14,22,0.55)';
  ctx.fillRect(0, 0, w, h);
  text(ctx, title, w / 2, h * titleY, 'bold 54px sans-serif', accent, 'center');
  lines.forEach((line, i) => {
    text(ctx, line, w / 2, h * titleY + 44 + i * 30, '20px sans-serif', '#eaf3f8', 'center');
  });
}

// The whole frame: sky, terrain, runway, rings, plane, instruments, screens.
export function render(ctx, world, view) {
  const { width: w, height: h, time } = view;
  const plane = world.plane;
  const cam = makeCamera(plane, w, h);
  drawSky(ctx, w, h, cam);
  drawClouds(ctx, cam, time);
  drawTerrain(ctx, cam, w, h);
  drawRunway(ctx, cam);
  drawRings(ctx, cam, world);
  if (world.screen === SCREEN_TITLE) {
    // Title: the plane sits on the strip with the valley ahead, text above it.
    drawPlane(ctx, w, h, world, time, h * 0.14);
    overlay(ctx, w, h, 'RIDGE RUNNER', [
      'Fly the Cendrawasih through ten rings over the Merapi valley,',
      'then bring her home to the strip.',
      '',
      'ARROWS / WASD — pitch & bank    SHIFT / CTRL — throttle',
      'MOUSE — steer    R — restart    P — pause    M — sound',
      '',
      'PRESS ENTER TO FLY',
    ], '#ffd34d', 0.14);
    return;
  }
  drawPlane(ctx, w, h, world, time);
  drawHud(ctx, w, h, world);
  drawDashboard(ctx, w, h, world);
  if (world.screen === SCREEN_PAUSE) {
    overlay(ctx, w, h, 'PAUSED', ['Press P to keep flying.'], '#cfe3ee');
  } else if (world.screen === SCREEN_CRASH) {
    overlay(ctx, w, h, 'CRASHED', [
      world.crashReason,
      `Score ${world.score}  ·  Rings ${world.ringIndex}/${world.rings.length}`,
      '',
      'PRESS R TO FLY AGAIN',
    ], '#ff5a4d');
  } else if (world.screen === SCREEN_DONE) {
    const mins = Math.floor(world.time / 60);
    const secs = Math.floor(world.time % 60);
    overlay(ctx, w, h, 'COURSE COMPLETE', [
      `All ten rings, and a safe landing on the strip.`,
      `Score ${world.score}  ·  Time ${mins}:${String(secs).padStart(2, '0')}`,
      '',
      'PRESS R TO FLY AGAIN',
    ], '#7fd67f');
  }
}
