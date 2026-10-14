import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS, SIM, type FlightParams } from '../src/shared/config.ts';
import { coach, parseManeuvers, result, startRun, updateRun, type Run } from '../src/shared/exercises.ts';
import { createState, DEG, forwardOf, gustAt, rightOf, step, windFrom, type DroneState } from '../src/shared/physics.ts';
import { NEUTRAL, type Sticks } from '../src/shared/sticks.ts';

const DT = 1 / 120;
const EXERCISES = parseManeuvers(JSON.parse(readFileSync(new URL('../config/maneuvers.json', import.meta.url), 'utf8'))).exercises;
const hover = EXERCISES.find((e) => e.id === 'hover')!;
const at = (x: number, y: number, z: number, yawDeg = 0) => createState({ x, y, z }, yawDeg * DEG);

function sit(run: Run, s: DroneState, seconds: number, sticks: (i: number) => Sticks = () => NEUTRAL) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const e = updateRun(run, s, sticks(i), DT);
    if (e) events.push(e);
  }
  return events;
}

function land(run: Run, x: number, z: number, vy: number) {
  const s = at(x, 1, z);
  s.vel.y = vy;
  updateRun(run, s, NEUTRAL, DT);
  return updateRun(run, at(x, 0, z), NEUTRAL, DT);
}

describe('exercises', () => {
  it('every exercise has steps, a par time and sensible targets', () => {
    for (const ex of EXERCISES) {
      expect(ex.steps.length).toBeGreaterThan(0);
      expect(ex.par).toBeGreaterThan(0);
      for (const s of ex.steps) expect(s.radius).toBeGreaterThan(0);
    }
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
  });

  it('a perfect hover and landing scores 100 accuracy', () => {
    const run = startRun(hover);
    expect(sit(run, at(0, 3, -10), 8.1)).toEqual(['step']);
    expect(land(run, 0, -10, -0.5)).toBe('done');
    const r = result(run);
    expect(r.accuracy).toBe(100);
    expect(r.stars).toBe(3);
  });

  it('the hold timer only runs inside the target', () => {
    const run = startRun(hover);
    sit(run, at(5, 3, -10), 20); // 5 m off to the side
    expect(run.step).toBe(0);
    expect(run.held).toBe(0);
  });

  it('a sloppy hover scores lower than a tidy one', () => {
    const tidy = startRun(hover), sloppy = startRun(hover);
    sit(tidy, at(0.1, 3, -10), 8.1);
    sit(sloppy, at(0.8, 3.5, -10), 8.1);
    expect(sloppy.scores[0]).toBeLessThan(tidy.scores[0] - 20);
  });

  it('a hard landing or a miss costs points', () => {
    const score = (x: number, vy: number) => {
      const run = startRun(hover);
      sit(run, at(0, 3, -10), 8.1);
      land(run, x, -10, vy);
      return run.scores[1];
    };
    expect(score(0, -0.5)).toBe(100);
    expect(score(0, -3)).toBeLessThan(80);
    expect(score(0.8, -0.5)).toBeLessThan(60);
  });

  it('a nose-in hold needs the nose to face the pilot', () => {
    const run = startRun(EXERCISES.find((e) => e.id === 'nose-in')!);
    sit(run, at(0, 3, -10), 2.1); // take-off step
    sit(run, at(0, 3, -12, 0), 15);
    expect(run.step).toBe(1);
    sit(run, at(0, 3, -12, 180), 10.1);
    expect(run.step).toBe(2);
  });

  it('coaches from the pilot point of view', () => {
    const run = startRun(hover);
    expect(coach(run, at(-4, 3, -10))).toBe('Move to your right');
    expect(coach(run, at(0, 3, -16))).toBe('Bring it closer to you');
    expect(coach(run, at(0, 0.5, -10))).toBe('Climb');
    const nose = startRun(EXERCISES.find((e) => e.id === 'nose-in')!);
    sit(nose, at(0, 3, -10), 2.1);
    expect(coach(nose, at(0, 3, -12, 90))).toBe('Yaw right (clockwise)');
  });

  it('slow runs lose speed points but keep accuracy', () => {
    const run = startRun(hover);
    sit(run, at(5, 3, -10), 60); // wander for a minute first
    sit(run, at(0, 3, -10), 8.1);
    land(run, 0, -10, -0.5);
    const r = result(run);
    expect(r.accuracy).toBe(100);
    expect(r.speed).toBeLessThan(50);
  });

  it('scores how straight you fly each leg, not just reaching the hoop', () => {
    const box = EXERCISES.find((e) => e.id === 'box')!;
    const leg = (offLine: number) => {
      const run = startRun(box);
      sit(run, at(0, 3, -10), 3.1); // take-off hold done; next leg runs from (0, 3, -10) to (-10, 3, -10)
      for (let x = 0; x >= -10; x -= 0.02) updateRun(run, at(x, 3, -10 - offLine * Math.sin((-x / 10) * Math.PI)), NEUTRAL, DT);
      return run.scores[1];
    };
    expect(leg(0)).toBe(100);
    expect(leg(1.5)).toBeLessThan(leg(0) - 25);
  });

  it('jerky sticks cost smoothness points', () => {
    const smooth = startRun(hover), jerky = startRun(hover);
    sit(smooth, at(0, 3, -10), 8.1);
    sit(jerky, at(0, 3, -10), 8.1, (i) => ({ ...NEUTRAL, roll: i % 12 < 6 ? 0.8 : -0.8 }));
    for (const r of [smooth, jerky]) land(r, 0, -10, -0.5);
    expect(result(smooth).smoothness).toBe(100);
    expect(result(jerky).smoothness).toBeLessThan(50);
  });

  it('counts boundary and height breaches and takes points off', () => {
    const run = startRun(hover);
    sit(run, at(0, SIM.heightLimit + 1, -10), 1);
    sit(run, at(0, 3, -10), 1);
    sit(run, at(SIM.boundary + 1, 3, 0), 1);
    expect(coach(run, at(SIM.boundary + 1, 3, 0))).toMatch(/Outside the area/);
    sit(run, at(0, 3, -10), 8.1);
    land(run, 0, -10, -0.5);
    expect(result(run).breaches).toBe(2);
    expect(result(run).score).toBeLessThan(85);
  });

  it('records replay samples at the recording rate', () => {
    const run = startRun(hover);
    sit(run, at(0, 3, -10), 2);
    expect(run.samples.length).toBeGreaterThanOrEqual(2 * SIM.recordHz);
    expect(run.samples.length).toBeLessThanOrEqual(2 * SIM.recordHz + 1);
    expect(run.samples[0]).toHaveLength(13);
  });
});

describe('every exercise is flyable', () => {
  // A crude virtual pilot: steer toward the current target the way a student would, through the real physics.
  function pilot(run: Run, s: DroneState, p: FlightParams): Sticks {
    const step = run.ex.steps[run.step];
    const dx = step.at.x - s.pos.x, dz = step.at.z - s.pos.z, dist = Math.hypot(dx, dz);
    const sp = Math.min(p.maxSpeed * 0.5, dist * 2) / Math.max(dist, 1e-6);
    let vx = dx * sp, vz = dz * sp;
    if (p.mode === 'attitude') { vx = 0.4 * vx - 0.5 * s.vel.x; vz = 0.4 * vz - 0.5 * s.vel.z; } // tilt = acceleration
    const f = forwardOf(s.yaw), r = rightOf(s.yaw), lim = (n: number) => Math.max(-1, Math.min(1, n));
    const k = p.mode === 'attitude' ? 0.6 : 1 / p.maxSpeed;
    const landing = step.kind === 'land' && dist < step.radius * 0.6 && Math.hypot(s.vel.x, s.vel.z) < 0.3;
    const yawErr = step.kind === 'hold' && step.yaw !== undefined ? ((step.yaw - s.yaw / DEG + 540) % 360) - 180 : 0;
    return {
      pitch: lim((vx * f.x + vz * f.z) * k),
      roll: lim((vx * r.x + vz * r.z) * k),
      throttle: step.kind === 'land' ? (landing ? -0.5 : lim(2 - s.pos.y)) : lim(step.at.y - s.pos.y),
      yaw: lim(yawErr / 45),
    };
  }

  for (const ex of EXERCISES) {
    it(ex.name, () => {
      const p = { ...PRESETS.agile.params, ...ex.params };
      const steady = ex.wind ? windFrom(ex.wind.speed, ex.wind.from) : { x: 0, y: 0, z: 0 };
      const s = createState({ x: 0, y: 0, z: -10 }, ex.startYaw * DEG);
      const run = startRun(ex);
      for (let i = 0; i < 300 / DT && !run.done; i++) {
        const g = gustAt(i * DT, ex.wind?.gusts ?? 0), sticks = pilot(run, s, p);
        step(s, sticks, p, { x: steady.x + g.x, y: steady.y + g.y, z: steady.z + g.z }, DT);
        updateRun(run, s, sticks, DT);
      }
      expect(run.done, `stuck on step ${run.step + 1}: ${ex.steps[run.step]?.text}`).toBe(true);
      expect(result(run).score).toBeGreaterThan(50);
    });
  }
});
