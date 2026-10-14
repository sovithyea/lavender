import { describe, expect, it } from 'vitest';
import { PRESETS, type FlightParams } from '../src/shared/config.ts';
import { createState, DEG, gustAt, step, windFrom, type DroneState } from '../src/shared/physics.ts';
import { NEUTRAL, type Sticks } from '../src/shared/sticks.ts';

const DT = 1 / 120;
const CALM = { x: 0, y: 0, z: 0 };
const agile = (): FlightParams => ({ ...PRESETS.agile.params });

function fly(s: DroneState, sticks: Sticks, p: FlightParams, seconds: number, wind = CALM, each?: (s: DroneState) => void) {
  for (let i = 0; i < Math.round(seconds / DT); i++) { step(s, sticks, p, wind, DT); each?.(s); }
  return s;
}
const gs = (s: DroneState) => Math.hypot(s.vel.x, s.vel.z);

describe('physics step', () => {
  it('holds a hover with centred sticks', () => {
    const s = fly(createState({ x: 0, y: 5, z: -10 }, 0), NEUTRAL, agile(), 5);
    expect(Math.hypot(s.pos.x, s.pos.y - 5, s.pos.z + 10)).toBeLessThan(0.05);
    expect(Math.hypot(s.vel.x, s.vel.y, s.vel.z)).toBeLessThan(0.02);
  });

  it('sits still on the ground with centred sticks', () => {
    const s = fly(createState({ x: 0, y: 0, z: -10 }, 0), NEUTRAL, agile(), 3);
    expect(s.pos).toEqual({ x: 0, y: 0, z: -10 });
  });

  it('reaches but never exceeds max speed and max tilt', () => {
    for (const preset of [PRESETS.agile, PRESETS.heavy]) {
      const p = { ...preset.params };
      let maxTilt = 0, maxGs = 0;
      fly(createState({ x: 0, y: 20, z: 0 }, 0), { ...NEUTRAL, pitch: 1, roll: 1 }, p, 15, CALM, (s) => {
        maxTilt = Math.max(maxTilt, Math.abs(s.pitch), Math.abs(s.roll));
        maxGs = Math.max(maxGs, gs(s));
      });
      expect(maxTilt).toBeLessThanOrEqual(p.maxTiltDeg * DEG * 1.02);
      expect(maxGs).toBeLessThanOrEqual(p.maxSpeed * 1.05);
      expect(maxGs).toBeGreaterThan(p.maxSpeed * 0.9);
    }
  });

  it('brakes to a stop and holds position when sticks are released', () => {
    const p = agile();
    const s = fly(createState({ x: 0, y: 10, z: 0 }, 0), { ...NEUTRAL, pitch: 1 }, p, 5);
    fly(s, NEUTRAL, p, 6);
    expect(gs(s)).toBeLessThan(0.1);
    const settled = { ...s.pos };
    fly(s, NEUTRAL, p, 4);
    expect(Math.hypot(s.pos.x - settled.x, s.pos.z - settled.z)).toBeLessThan(0.1);
  });

  it('climbs at max climb rate on full throttle', () => {
    const p = agile();
    const s = fly(createState({ x: 0, y: 0, z: 0 }, 0), { ...NEUTRAL, throttle: 1 }, p, 4);
    expect(s.vel.y).toBeCloseTo(p.maxClimb, 1);
  });

  it('yaws at max yaw rate on full yaw', () => {
    const p = agile();
    const s = fly(createState({ x: 0, y: 5, z: 0 }, 0), { ...NEUTRAL, yaw: 1 }, p, 2);
    expect(s.yawRate / DEG).toBeCloseTo(p.maxYawRateDeg, 0);
  });

  it('flies toward the pilot on forward stick when nose-in', () => {
    // Nose-in: heading 180°, so forward stick moves toward the pilot at the origin (+z).
    const s = fly(createState({ x: 0, y: 5, z: -20 }, Math.PI), { ...NEUTRAL, pitch: 1 }, agile(), 2);
    expect(s.pos.z).toBeGreaterThan(-15);
    expect(Math.abs(s.pos.x)).toBeLessThan(0.1);
  });

  it('applies motor lag: the heavier feel responds more slowly', () => {
    const rise = (p: FlightParams) => fly(createState({ x: 0, y: 5, z: 0 }, 0), { ...NEUTRAL, throttle: 1 }, p, 0.05).thrust;
    const agileRise = rise(agile()), heavyRise = rise({ ...PRESETS.heavy.params });
    expect(agileRise).toBeGreaterThan(heavyRise);
    const s = createState({ x: 0, y: 5, z: 0 }, 0);
    step(s, { ...NEUTRAL, throttle: 1 }, agile(), CALM, DT);
    expect(s.thrust).toBeLessThan(9.81 + 4 * 0.5); // one step is nowhere near the commanded thrust
  });

  it('drifts with the wind in attitude mode but holds in stabilised mode', () => {
    const wind = { x: 5, y: 0, z: 0 };
    const atti = fly(createState({ x: 0, y: 10, z: 0 }, 0), NEUTRAL, { ...agile(), mode: 'attitude' }, 10, wind);
    const stab = fly(createState({ x: 0, y: 10, z: 0 }, 0), NEUTRAL, agile(), 20, wind);
    expect(atti.pos.x).toBeGreaterThan(10);
    expect(Math.abs(stab.pos.x)).toBeLessThan(1);
  });

  it('gusts vary over time, stay within their strength and average out', () => {
    let maxH = 0, sumX = 0, sumZ = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const g = gustAt(i * 0.1, 3);
      maxH = Math.max(maxH, Math.hypot(g.x, g.z));
      sumX += g.x; sumZ += g.z;
    }
    expect(maxH).toBeGreaterThan(1.5);
    expect(maxH).toBeLessThanOrEqual(3 * Math.SQRT2);
    expect(Math.abs(sumX / n)).toBeLessThan(0.2);
    expect(Math.abs(sumZ / n)).toBeLessThan(0.2);
    const calm = gustAt(5, 0);
    expect(Math.hypot(calm.x, calm.y, calm.z)).toBe(0);
  });

  it('wind blows from the bearing it is named for', () => {
    const towardPilot = windFrom(5, 0), towardLeft = windFrom(5, 90);
    expect(towardPilot.z).toBeCloseTo(5);
    expect(towardPilot.x).toBeCloseTo(0);
    expect(towardLeft.x).toBeCloseTo(-5);
    // An attitude-mode drone in wind from 90° (pilot's right) drifts left.
    const s = fly(createState({ x: 0, y: 10, z: 0 }, 0), NEUTRAL, { ...agile(), mode: 'attitude' }, 5, towardLeft);
    expect(s.pos.x).toBeLessThan(-3);
  });
});
