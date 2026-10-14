import { SCORING, SIM, type FlightParams } from './config.ts';
import { DEG, type DroneState, type Vec3 } from './physics.ts';
import { NEUTRAL, type Sticks } from './sticks.ts';

// Training exercises, loaded from config/maneuvers.json (see parseManeuvers for the format).
// World frame as in physics.ts: the pilot stands at the origin facing -z; x is the pilot's right.
// Yaw in degrees: 0 = nose away from the pilot, 90 = nose to the pilot's right, 180 = nose toward the pilot.

export type Step =
  | { kind: 'hold'; text: string; at: Vec3; radius: number; height: number; yaw?: number; seconds: number }
  | { kind: 'gate'; text: string; at: Vec3; radius: number; lateral: number; vertical: number }
  | { kind: 'land'; text: string; at: Vec3; radius: number };

export interface Exercise {
  id: string;
  name: string;
  skill: string;
  brief: string;
  par: number;               // s, a good finishing time
  startYaw: number;          // deg
  headingTol: number;        // deg
  params?: Partial<FlightParams>;
  wind?: { speed: number; from: number; gusts: number };
  poles: Vec3[];             // points of interest to fly around
  steps: Step[];
}

export type Mode = 'guided' | 'test';
export const START = { x: 0, y: 0, z: -SIM.spawnDistance };

// --- config/maneuvers.json
//
// An array of maneuvers. Coordinates are pilot-relative metres: [x right, y up, z away from you].
// {
//   "id": "box", "name": "Box pattern", "skill": "Coordination", "brief": "…", "par": 60,
//   "start": { "heading": 0 },                                   optional, deg (0 = nose away)
//   "flightMode": "attitude",                                    optional, forces attitude mode
//   "wind": { "speed": 4, "from": 90, "gusts": 1 },              optional, overrides the panel
//   "tolerance": { "lateral": 1.5, "vertical": 1, "headingDeg": 20 },   optional defaults for every step
//   "poles": [[0, 30]],                                          optional [x, z] markers to fly around
//   "steps": [
//     { "hold": [0, 3, 10], "seconds": 3, "text": "…", "yaw": 180, "radius": 1, "height": 0.75 },
//     { "gate": [-10, 3, 10], "text": "…", "radius": 1.5 },
//     { "arc": { "center": [0, 30], "radius": 10, "from": 180, "sweep": 360, "y": 5, "gates": 8 }, "text": "…" },
//     { "land": [0, 0, 10], "text": "…", "radius": 1 }
//   ]
// }
// arc: a run of gates around a centre. "from" is the bearing of the first gate from the centre
// (0 = far side, 90 = your right); "sweep" is how far round to go, positive = clockwise from above.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const world = ([x, y, z]: number[]): Vec3 => ({ x, y, z: -z });

export function parseManeuvers(json: unknown): { exercises: Exercise[]; errors: string[] } {
  const errors: string[] = [], exercises: Exercise[] = [];
  if (!Array.isArray(json)) return { exercises, errors: ['maneuvers.json: expected an array of maneuvers'] };
  const ids = new Set<string>();

  json.forEach((m, i) => {
    let at = `maneuvers[${i}]`;
    if (!isObj(m)) { errors.push(`${at}: expected an object`); return; }
    if (typeof m.id === 'string') at = `maneuvers[${i}] ("${m.id}")`;
    const before = errors.length;
    const err = (path: string, msg: string) => errors.push(`${at}${path}: ${msg}`);
    const text = (o: Obj, key: string, path: string, required = true) => {
      if (typeof o[key] === 'string' && o[key]) return o[key] as string;
      if (required || o[key] !== undefined) err(`${path}.${key}`, 'expected a non-empty string');
      return '';
    };
    const pos = (o: Obj, key: string, path: string, min = -Infinity, fallback?: number) => {
      if (o[key] === undefined && fallback !== undefined) return fallback;
      if (isNum(o[key]) && (o[key] as number) > min) return o[key] as number;
      err(`${path}.${key}`, min === 0 ? 'expected a number above 0' : 'expected a number');
      return fallback ?? 1;
    };
    const point = (v: unknown, path: string, n: 2 | 3) => {
      if (Array.isArray(v) && v.length === n && v.every(isNum)) return v as number[];
      err(path, `expected [${n === 3 ? 'x, y, z' : 'x, z'}] numbers`);
      return null;
    };

    const id = text(m, 'id', ''), name = text(m, 'name', ''), par = pos(m, 'par', '', 0);
    if (id && ids.has(id)) err('.id', `duplicate id "${id}"`);
    ids.add(id);
    const tol = isObj(m.tolerance) ? m.tolerance : {};
    if (m.tolerance !== undefined && !isObj(m.tolerance)) err('.tolerance', 'expected an object');
    const lateral = pos(tol, 'lateral', '.tolerance', 0, 1);
    const vertical = pos(tol, 'vertical', '.tolerance', 0, 0.75);
    const headingTol = pos(tol, 'headingDeg', '.tolerance', 0, 20);
    const start = isObj(m.start) ? m.start : {};
    const startYaw = pos(start, 'heading', '.start', -Infinity, 0);

    let params: Partial<FlightParams> | undefined;
    if (m.flightMode !== undefined) {
      if (m.flightMode === 'attitude' || m.flightMode === 'stabilised') params = { mode: m.flightMode };
      else err('.flightMode', 'expected "stabilised" or "attitude"');
    }
    let wind: Exercise['wind'];
    if (m.wind !== undefined) {
      if (!isObj(m.wind)) err('.wind', 'expected an object');
      else wind = { speed: pos(m.wind, 'speed', '.wind', -Infinity), from: pos(m.wind, 'from', '.wind', -Infinity), gusts: pos(m.wind, 'gusts', '.wind', -Infinity, 0) };
    }
    const poles: Vec3[] = [];
    if (m.poles !== undefined) {
      if (!Array.isArray(m.poles)) err('.poles', 'expected an array of [x, z]');
      else m.poles.forEach((p, j) => { const xz = point(p, `.poles[${j}]`, 2); if (xz) poles.push(world([xz[0], 0, xz[1]])); });
    }

    const steps: Step[] = [];
    if (!Array.isArray(m.steps) || m.steps.length === 0) err('.steps', 'expected a non-empty array of steps');
    else m.steps.forEach((s, j) => {
      const path = `.steps[${j}]`;
      if (!isObj(s)) { err(path, 'expected an object'); return; }
      const kinds = ['hold', 'gate', 'land', 'arc'].filter((k) => s[k] !== undefined);
      if (kinds.length !== 1) { err(path, 'needs exactly one of "hold", "gate", "land" or "arc"'); return; }
      const label = text(s, 'text', path);
      const radius = pos(s, 'radius', path, 0, lateral);
      if (s.hold !== undefined) {
        const p = point(s.hold, `${path}.hold`, 3);
        const yaw = s.yaw === undefined ? undefined : pos(s, 'yaw', path);
        if (p) steps.push({ kind: 'hold', text: label, at: world(p), radius, height: pos(s, 'height', path, 0, vertical), yaw, seconds: pos(s, 'seconds', path, 0) });
      } else if (s.gate !== undefined) {
        const p = point(s.gate, `${path}.gate`, 3);
        if (p) steps.push({ kind: 'gate', text: label, at: world(p), radius, lateral, vertical });
      } else if (s.land !== undefined) {
        const p = point(s.land, `${path}.land`, 3);
        if (p && p[1] !== 0) err(`${path}.land`, 'landing points are on the ground: y must be 0');
        if (p) steps.push({ kind: 'land', text: label, at: world(p), radius });
      } else {
        const a = s.arc, ap = `${path}.arc`;
        if (!isObj(a)) { err(ap, 'expected an object'); return; }
        const c = point(a.center, `${ap}.center`, 2);
        const r = pos(a, 'radius', ap, 0), from = pos(a, 'from', ap), sweep = pos(a, 'sweep', ap), y = pos(a, 'y', ap, 0);
        const n = pos(a, 'gates', ap, 0);
        if (!Number.isInteger(n)) err(`${ap}.gates`, 'expected a whole number');
        if (!c) return;
        for (let g = 1; g <= n; g++) {
          const b = (from + (sweep * g) / n) * DEG;
          steps.push({ kind: 'gate', text: `${label} (${g}/${n})`, at: world([c[0] + Math.sin(b) * r, y, c[1] + Math.cos(b) * r]), radius, lateral, vertical });
        }
      }
    });

    if (errors.length > before) return;
    exercises.push({
      id, name, skill: text(m, 'skill', '', false), brief: text(m, 'brief', '', false), par,
      startYaw, headingTol, params, wind, poles, steps,
    });
  });
  return { exercises, errors };
}

// --- a run through one exercise

export interface Run {
  ex: Exercise;
  mode: Mode;
  step: number;
  elapsed: number;
  held: number;        // s inside the hold target (current step)
  errSum: number;      // error integral for the current step
  errTime: number;
  err: number;         // live error, 1 = on the edge of the tolerance
  inside: boolean;
  airborne: boolean;
  lastVy: number;      // vertical speed just before touchdown
  scores: number[];
  stickSq: number;     // integral of squared stick rate, for smoothness
  prevSticks: Sticks;
  breaching: boolean;
  breaches: number;
  samples: number[][]; // replay: [t, x, y, z, roll, pitch, yaw, throttle, yawStick, pitchStick, rollStick, err, step]
  nextSample: number;
  done: boolean;
}

export interface Result {
  score: number; accuracy: number; speed: number; smoothness: number; breaches: number;
  stars: number; time: number; steps: number[];
}

export const startRun = (ex: Exercise, mode: Mode = 'guided'): Run => ({
  ex, mode, step: 0, elapsed: 0, held: 0, errSum: 0, errTime: 0, err: 0, inside: false, airborne: false, lastVy: 0,
  scores: [], stickSq: 0, prevSticks: NEUTRAL, breaching: false, breaches: 0, samples: [], nextSample: 0, done: false,
});

const wrapDeg = (a: number) => ((a + 540) % 360) - 180;
const precision = (meanErr: number) => Math.round(100 * Math.max(0, 1 - 0.6 * meanErr));
const prevPoint = (run: Run) => (run.step > 0 ? run.ex.steps[run.step - 1].at : START);

// How far off the target is, per axis, as a fraction of its tolerance (1 = right on the edge).
export function offsets(step: Step, s: DroneState, headingTol = 20) {
  const dx = step.at.x - s.pos.x, dy = step.at.y - s.pos.y, dz = step.at.z - s.pos.z;
  const yawErr = step.kind === 'hold' && step.yaw !== undefined ? wrapDeg(step.yaw - s.yaw / DEG) : 0;
  const tolY = step.kind === 'hold' ? step.height : step.kind === 'gate' ? step.vertical : 2;
  return { dx, dy, dz, yawErr, h: Math.hypot(dx, dz) / step.radius, v: Math.abs(dy) / tolY, yaw: Math.abs(yawErr) / headingTol };
}

// How far the drone is off the straight leg into a gate: sideways and in height, as fractions of the tolerance.
export function legError(from: Vec3, step: Extract<Step, { kind: 'gate' }>, s: DroneState) {
  const ax = step.at.x - from.x, az = step.at.z - from.z, len2 = ax * ax + az * az;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((s.pos.x - from.x) * ax + (s.pos.z - from.z) * az) / len2)) : 1;
  const side = Math.hypot(s.pos.x - (from.x + ax * t), s.pos.z - (from.z + az * t));
  const height = Math.abs(s.pos.y - (from.y + (step.at.y - from.y) * t));
  return Math.max(side / step.lateral, height / step.vertical);
}

// Advance a run by one physics step. Returns 'step' when a step completes and 'done' when the exercise ends.
export function updateRun(run: Run, s: DroneState, sticks: Sticks, dt: number): 'step' | 'done' | null {
  if (run.done) return null;
  run.elapsed += dt;
  const step = run.ex.steps[run.step];
  const o = offsets(step, s, run.ex.headingTol);
  let complete = false;

  // Smoothness: how fast the sticks are being moved.
  const p = run.prevSticks;
  run.stickSq += ((sticks.throttle - p.throttle) ** 2 + (sticks.yaw - p.yaw) ** 2 + (sticks.pitch - p.pitch) ** 2 + (sticks.roll - p.roll) ** 2) / dt;
  run.prevSticks = sticks;

  // Breaches: count each time the drone leaves the area or goes too high.
  const breaching = Math.hypot(s.pos.x, s.pos.z) > SIM.boundary || s.pos.y > SIM.heightLimit;
  if (breaching && !run.breaching) run.breaches++;
  run.breaching = breaching;

  if (step.kind === 'hold') {
    run.err = Math.max(o.h, o.v, o.yaw);
    run.inside = s.pos.y > 0 && run.err <= 1;
    if (run.inside) {
      run.held += dt;
      run.errSum += run.err * dt;
      run.errTime += dt;
    }
    complete = run.held >= step.seconds;
  } else if (step.kind === 'gate') {
    run.err = legError(prevPoint(run), step, s);
    run.errSum += Math.min(2, run.err) * dt;
    run.errTime += dt;
    run.inside = Math.hypot(o.dx, o.dy, o.dz) <= step.radius;
    complete = run.inside;
  } else {
    run.err = o.h;
    if (s.pos.y > 0.3) run.airborne = true;
    if (s.pos.y > 0) run.lastVy = s.vel.y;
    run.inside = o.h <= 1;
    if (run.airborne && s.pos.y === 0) {
      run.errSum = o.h + (run.lastVy < -1.5 ? 0.5 : 0); // a hard landing costs as much as missing by half the pad
      run.errTime = 1;
      complete = true;
    }
  }

  if (run.elapsed >= run.nextSample) {
    run.nextSample += 1 / SIM.recordHz;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    run.samples.push([run.elapsed, s.pos.x, s.pos.y, s.pos.z, s.roll, s.pitch, s.yaw,
      sticks.throttle, sticks.yaw, sticks.pitch, sticks.roll, Math.min(run.err, 9), run.step].map(r));
  }
  if (!complete) return null;

  run.scores.push(precision(run.errTime > 0 ? run.errSum / run.errTime : 0));
  Object.assign(run, { step: run.step + 1, held: 0, errSum: 0, errTime: 0, inside: false, airborne: false });
  if (run.step < run.ex.steps.length) return 'step';
  run.done = true;
  return 'done';
}

export function result(run: Run): Result {
  const accuracy = Math.round(run.scores.reduce((a, b) => a + b, 0) / run.scores.length);
  const speed = Math.round(100 * Math.min(1, run.ex.par / run.elapsed));
  const smoothness = Math.round(100 * Math.max(0, 1 - Math.sqrt(run.stickSq / run.elapsed) / SCORING.stickRateRef));
  const raw = SCORING.accuracy * accuracy + SCORING.speed * speed + SCORING.smoothness * smoothness - SCORING.breachPenalty * run.breaches;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, accuracy, speed, smoothness, breaches: run.breaches, stars: stars(score), time: run.elapsed, steps: run.scores };
}

export const stars = (score: number) => (score >= 90 ? 3 : score >= 75 ? 2 : score >= 60 ? 1 : 0);

// One plain-English tip at a time, from the pilot's point of view, for whichever error is biggest.
export function coach(run: Run, s: DroneState): string {
  const step = run.ex.steps[run.step];
  if (!step) return '';
  if (run.breaching) return s.pos.y > SIM.heightLimit ? `Too high: stay under ${SIM.heightLimit} m` : 'Outside the area: bring it back toward you';
  const o = offsets(step, s, run.ex.headingTol);
  if (step.kind === 'land' && o.h <= 0.5) return s.vel.y < -1.5 ? 'Slow your descent' : 'Descend gently onto the pad';
  if (step.kind === 'hold' && run.inside) return 'Good. Hold it steady';
  const hTol = step.kind === 'land' ? step.radius * 0.5 : step.radius * 0.7;
  const tips: [number, string][] = [
    [step.kind === 'land' ? 0 : o.v, o.dy > 0 ? 'Climb' : 'Descend'],
    [Math.abs(o.dx) / hTol, o.dx > 0 ? 'Move to your right' : 'Move to your left'],
    [Math.abs(o.dz) / hTol, o.dz > 0 ? 'Bring it closer to you' : 'Move it further away'],
    [o.yaw, o.yawErr > 0 ? 'Yaw right (clockwise)' : 'Yaw left (anticlockwise)'],
  ];
  tips.sort((a, b) => b[0] - a[0]);
  return tips[0][0] > 0.5 ? tips[0][1] : step.kind === 'gate' ? 'Fly through the hoop' : 'Nearly there';
}
