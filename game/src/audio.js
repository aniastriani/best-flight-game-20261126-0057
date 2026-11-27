// Ridge Runner's sounds, all synthesised with WebAudio: an engine hum that
// follows the throttle, wind that rises with speed, a chime for each ring,
// and a low thud for a crash. No audio files are shipped or fetched.
export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let windGain = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(ctx.destination);
    engineOsc.start();
    // Wind: looped noise through a band-pass filter.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 480;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    noise.connect(band);
    band.connect(windGain);
    windGain.connect(ctx.destination);
    noise.start();
    return true;
  }

  function tone(freq, when, dur, type = 'sine', vol = 0.16) {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime + when);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(ctx.currentTime + when);
    osc.stop(ctx.currentTime + when + dur + 0.05);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') void ctx.resume();
    },
    update(throttle, speed, flying) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(flying ? 0.05 + throttle * 0.06 : 0.0, t, 0.1);
      engineOsc.frequency.setTargetAtTime(48 + throttle * 62 + speed * 0.35, t, 0.1);
      windGain.gain.setTargetAtTime(flying ? Math.min(0.12, speed * 0.0011) : 0, t, 0.15);
    },
    ring() {
      tone(660, 0, 0.28);
      tone(990, 0.09, 0.4);
    },
    takeoff() {
      tone(392, 0, 0.2);
      tone(523, 0.1, 0.3);
    },
    land() {
      tone(523, 0, 0.25);
      tone(659, 0.1, 0.25);
      tone(784, 0.2, 0.5);
    },
    crash() {
      if (!ctx || muted) return;
      tone(70, 0, 0.7, 'sine', 0.4);
      tone(48, 0.05, 0.8, 'triangle', 0.3);
    },
    toggleMute() {
      muted = !muted;
      if (ctx) {
        engineGain.gain.value = 0;
        windGain.gain.value = 0;
      }
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
