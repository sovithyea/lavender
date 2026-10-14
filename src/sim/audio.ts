// Sound made with Web Audio, no audio files. Browsers only start audio after a click or key press on the page.
export interface SoundInput {
  on: boolean;
  volume: number;   // 0..1
  motors: boolean;  // spinning (airborne or throttle up)
  thrust: number;   // collective thrust as a multiple of g
  distance: number; // m from the pilot
  pitch: number;    // 1 = small quad; lower for a bigger, slower-spinning airframe
  wind: number;     // m/s
  beach: boolean;
}

export function createAudio() {
  const ctx = new AudioContext();
  const unlock = () => { void ctx.resume(); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  const master = ctx.createGain();
  master.connect(ctx.destination);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const noiseSource = () => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(0, Math.random() * 2);
    return s;
  };

  // Motors: four slightly detuned saws (one per rotor) beat against each other like a real quad, plus prop-wash hiss.
  const DETUNE = [0.985, 0.995, 1.004, 1.013];
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0;
  tone.connect(motorGain).connect(master);
  const oscs = DETUNE.map(() => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.connect(tone);
    o.start();
    return o;
  });
  const wash = ctx.createBiquadFilter();
  wash.type = 'bandpass';
  const washGain = ctx.createGain();
  washGain.gain.value = 0.6;
  noiseSource().connect(wash).connect(washGain).connect(tone);

  // Ambience: wind in the grass, or surf at the beach.
  const ambFilter = ctx.createBiquadFilter();
  ambFilter.type = 'lowpass';
  const ambGain = ctx.createGain();
  ambGain.gain.value = 0;
  noiseSource().connect(ambFilter).connect(ambGain).connect(master);

  const set = (p: AudioParam, v: number, tau = 0.08) => p.setTargetAtTime(v, ctx.currentTime, tau);
  return {
    running: () => ctx.state === 'running',
    update(o: SoundInput) {
      set(master.gain, o.on ? o.volume : 0);
      // Rotor speed goes roughly with the square root of thrust.
      const f = 210 * o.pitch * Math.sqrt(Math.max(0.2, o.thrust));
      oscs.forEach((osc, i) => set(osc.frequency, f * DETUNE[i], 0.05));
      set(wash.frequency, f * 6);
      // Quieter and duller with distance, as the air soaks up the high end. Spins down slower than it spins up.
      const d = Math.max(2, o.distance);
      set(motorGain.gain, o.motors ? Math.min(0.12, 0.6 / d) : 0, o.motors ? 0.15 : 0.6);
      set(tone.frequency, 600 + 6000 / (1 + d / 25));
      const surf = o.beach ? 0.05 + 0.04 * Math.max(0, Math.sin(ctx.currentTime * 0.8)) : 0; // a wave about every 8 s
      set(ambFilter.frequency, o.beach ? 900 : 350);
      set(ambGain.gain, 0.015 + o.wind * 0.006 + surf, 0.3);
    },
  };
}
