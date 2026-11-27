// Keyboard and mouse for Ridge Runner. Arrows or WASD fly the plane, Shift
// and Control work the throttle, and the mouse steers while it is held down
// over the canvas. R restarts, P pauses, M mutes, Enter starts.
export function createInput(canvas) {
  const keys = new Set();
  const input = {
    pitch: 0,
    roll: 0,
    throttle: 0,
    mouse: { active: false, x: 0, y: 0 },
  };
  let onKey = null;
  let onMouseDown = null;
  let onMouseMove = null;
  let onMouseUp = null;

  function keyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (onKey) onKey(e.key.length === 1 ? e.key.toLowerCase() : e.key, true);
  }

  function keyUp(e) {
    keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (onKey) onKey(e.key.length === 1 ? e.key.toLowerCase() : e.key, false);
  }

  function poll() {
    const up = keys.has('ArrowUp') || keys.has('w');
    const down = keys.has('ArrowDown') || keys.has('s');
    const left = keys.has('ArrowLeft') || keys.has('a');
    const right = keys.has('ArrowRight') || keys.has('d');
    // Arcade mapping: up pulls the nose up, down pushes it down.
    let pitch = (up ? 1 : 0) - (down ? 1 : 0);
    let roll = (right ? 1 : 0) - (left ? 1 : 0);
    let throttle = (keys.has('Shift') ? 1 : 0) - (keys.has('Control') ? 1 : 0);
    if (input.mouse.active) {
      // Mouse position relative to centre steers like a stick.
      const rect = canvas.getBoundingClientRect();
      const mx = (input.mouse.x - rect.left) / rect.width - 0.5;
      const my = (input.mouse.y - rect.top) / rect.height - 0.5;
      roll = Math.max(-1, Math.min(1, mx * 3));
      pitch = Math.max(-1, Math.min(1, -my * 3)); // mouse up climbs
    }
    input.pitch = pitch;
    input.roll = roll;
    input.throttle = throttle;
  }

  onMouseDown = (e) => {
    input.mouse.active = true;
    input.mouse.x = e.clientX;
    input.mouse.y = e.clientY;
  };
  onMouseMove = (e) => {
    input.mouse.x = e.clientX;
    input.mouse.y = e.clientY;
  };
  onMouseUp = () => {
    input.mouse.active = false;
  };

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  return {
    input,
    poll,
    set onKeyPress(fn) {
      onKey = fn;
    },
  };
}
