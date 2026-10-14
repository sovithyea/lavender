import type { FlightParams } from './config.ts';
import { DEG, type DroneState, type Vec3 } from './physics.ts';

// Training exercises modelled on the RePL practical manoeuvres.
// World frame as in physics.ts: the pilot stands at the origin facing -z; x is the pilot's right.
// Yaw in degrees: 0 = nose away from the pilot, 90 = nose to the pilot's right, 180 = nose toward the pilot.

export type Step =
  | { kind: 'hold'; text: string; at: Vec3; radius: number; height: number; yaw?: number; seconds: number }
  | { kind: 'gate'; text: string; at: Vec3; radius: number }
  | { kind: 'land'; text: string; at: Vec3; radius: number };

export interface Exercise {
  id: string;
  name: string;
  skill: string;
  brief: string;
  par: number;               // s, a good finishing time
  startYaw?: number;         // deg, default nose out
  params?: Partial<FlightParams>;
  wind?: { speed: number; from: number };
  poles?: Vec3[];            // points of interest to fly around
  steps: Step[];
}

const YAW_TOL = 20; // deg
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const PAD = v(0, 0, -10); // where the drone starts
const takeoff = (y = 3, seconds = 2): Step => ({ kind: 'hold', text: `Take off and climb to ${y} m`, at: v(0, y, -10), radius: 1.5, height: 1, seconds });
const landHome = (radius = 1): Step => ({ kind: 'land', text: 'Land back on the pad', at: PAD, radius });
const gates = (y: number, r: number, pts: [number, number, string][]): Step[] =>
  pts.map(([x, z, text]) => ({ kind: 'gate', text, at: v(x, y, z), radius: r }));

export const EXERCISES: Exercise[] = [
  {
    id: 'hover', name: 'Take-off and hover', skill: 'Throttle control',
    brief: 'Lift off, climb into the ring and hold it steady. Then land gently back on the pad.',
    par: 30,
    steps: [
      { kind: 'hold', text: 'Climb into the ring and hold steady', at: v(0, 3, -10), radius: 1, height: 0.75, seconds: 8 },
      landHome(),
    ],
  },
  {
    id: 'nose-in', name: 'Nose-in hover', skill: 'Orientation',
    brief: 'Turn the drone to face you and hold. Left and right are now reversed on the right stick.',
    par: 40,
    steps: [
      takeoff(),
      { kind: 'hold', text: 'Yaw until the nose faces you, then hold', at: v(0, 3, -12), radius: 1, height: 0.75, yaw: 180, seconds: 10 },
      landHome(),
    ],
  },
  {
    id: 'side-on', name: 'Side-on hovers', skill: 'Orientation',
    brief: 'Hold with the nose pointing to your right, then to your left. Forward stick now moves the drone sideways.',
    par: 50,
    steps: [
      takeoff(),
      { kind: 'hold', text: 'Point the nose to your right and hold', at: v(0, 3, -12), radius: 1, height: 0.75, yaw: 90, seconds: 8 },
      { kind: 'hold', text: 'Now point the nose to your left and hold', at: v(0, 3, -12), radius: 1, height: 0.75, yaw: 270, seconds: 8 },
      landHome(),
    ],
  },
  {
    id: 'box', name: 'Box pattern', skill: 'Coordination',
    brief: 'Fly a 20 m square through the four corner hoops at a steady 3 m. Keep your height level on every leg.',
    par: 60,
    steps: [
      takeoff(3, 3),
      ...gates(3, 1.5, [[-10, -10, 'Fly left to the first corner'], [-10, -30, 'Fly away to the far-left corner'],
        [10, -30, 'Fly across to the far-right corner'], [10, -10, 'Fly back toward you to the last corner']]),
      { kind: 'hold', text: 'Return to the start and hold', at: v(0, 3, -10), radius: 1, height: 0.75, seconds: 3 },
      landHome(),
    ],
  },
  {
    id: 'precision', name: 'Precision landing', skill: 'Judging distance',
    brief: 'Fly out to the far pad and land right on the centre. Distance is hard to judge from where you stand.',
    par: 35,
    steps: [
      takeoff(4),
      ...gates(4, 2, [[8, -28, 'Fly over to the far pad']]),
      { kind: 'land', text: 'Land on the centre of the pad', at: v(8, 0, -28), radius: 0.6 },
    ],
  },
  {
    id: 'figure8', name: 'Figure eight', skill: 'Smooth turns',
    brief: 'Fly a figure eight around the two poles at 4 m, through each hoop in order.',
    par: 90,
    poles: [v(-7, 0, -25), v(7, 0, -25)],
    steps: [
      takeoff(4),
      ...gates(4, 2, [[0, -25, 'Fly to the crossing point'], [-7, -32, 'Loop left: far side'], [-14, -25, 'Round the left pole'],
        [-7, -18, 'Near side of the left pole'], [0, -25, 'Through the crossing point'], [7, -32, 'Loop right: far side'],
        [14, -25, 'Round the right pole'], [7, -18, 'Near side of the right pole'], [0, -25, 'Finish at the crossing point']]),
      landHome(),
    ],
  },
  {
    id: 'orbit', name: 'Orbit', skill: 'Smooth turns',
    brief: 'Circle the pole at 10 m radius and 5 m height, like filming a point of interest.',
    par: 70,
    poles: [v(0, 0, -30)],
    steps: [
      takeoff(5),
      ...gates(5, 2, Array.from({ length: 9 }, (_, i): [number, number, string] => {
        const a = (i / 8) * 2 * Math.PI;
        return [-Math.sin(a) * 10, -30 + Math.cos(a) * 10, i === 0 ? 'Fly to the near side of the circle' : i === 8 ? 'Close the circle' : `Orbit: hoop ${i} of 8`];
      })),
      landHome(),
    ],
  },
  {
    id: 'atti-wind', name: 'Attitude mode in wind', skill: 'No-GPS control',
    brief: 'No GPS hold and a 4 m/s crosswind: the drone drifts unless you correct. Use small, early stick inputs.',
    par: 50,
    params: { mode: 'attitude' },
    wind: { speed: 4, from: 90 },
    steps: [
      takeoff(3),
      { kind: 'hold', text: 'Hold in the ring against the wind', at: v(0, 3, -12), radius: 1.5, height: 1, seconds: 15 },
      landHome(1.5),
    ],
  },
];

// --- a run through one exercise

export interface Run {
  ex: Exercise;
  step: number;
  elapsed: number;
  held: number;        // s inside the hold target (current step)
  errSum: number;      // error integral for the current step
  errTime: number;
  inside: boolean;
  airborne: boolean;
  lastVy: number;      // vertical speed just before touchdown
  scores: number[];
  done: boolean;
}

export interface Result { score: number; accuracy: number; speed: number; stars: number; time: number; steps: number[] }

export const startRun = (ex: Exercise): Run => ({
  ex, step: 0, elapsed: 0, held: 0, errSum: 0, errTime: 0, inside: false, airborne: false, lastVy: 0, scores: [], done: false,
});

const wrapDeg = (a: number) => ((a + 540) % 360) - 180;
const precision = (meanErr: number) => Math.round(100 * Math.max(0, 1 - 0.6 * meanErr));

// How far off the target is, per axis, as a fraction of its tolerance (1 = right on the edge).
export function offsets(step: Step, s: DroneState) {
  const dx = step.at.x - s.pos.x, dy = step.at.y - s.pos.y, dz = step.at.z - s.pos.z;
  const yawErr = step.kind === 'hold' && step.yaw !== undefined ? wrapDeg(step.yaw - s.yaw / DEG) : 0;
  const tolY = step.kind === 'hold' ? step.height : 2;
  return { dx, dy, dz, yawErr, h: Math.hypot(dx, dz) / step.radius, v: Math.abs(dy) / tolY, yaw: Math.abs(yawErr) / YAW_TOL };
}

// Advance a run by one physics step. Returns 'step' when a step completes and 'done' when the exercise ends.
export function updateRun(run: Run, s: DroneState, dt: number): 'step' | 'done' | null {
  if (run.done) return null;
  run.elapsed += dt;
  const step = run.ex.steps[run.step];
  const o = offsets(step, s);
  let complete = false;

  if (step.kind === 'hold') {
    run.inside = s.pos.y > 0 && o.h <= 1 && o.v <= 1 && o.yaw <= 1;
    if (run.inside) {
      run.held += dt;
      run.errSum += Math.max(o.h, o.v, o.yaw) * dt;
      run.errTime += dt;
    }
    complete = run.held >= step.seconds;
  } else if (step.kind === 'gate') {
    run.errSum += Math.min(1, o.v) * dt; // keeping a level height on the way there
    run.errTime += dt;
    run.inside = Math.hypot(o.dx, o.dy, o.dz) <= step.radius;
    complete = run.inside;
  } else {
    if (s.pos.y > 0.3) run.airborne = true;
    if (s.pos.y > 0) run.lastVy = s.vel.y;
    run.inside = o.h <= 1;
    if (run.airborne && s.pos.y === 0) {
      run.errSum = o.h + (run.lastVy < -1.5 ? 0.5 : 0); // a hard landing costs as much as missing by half the pad
      run.errTime = 1;
      complete = true;
    }
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
  const score = Math.round(0.8 * accuracy + 0.2 * speed);
  return { score, accuracy, speed, stars: score >= 90 ? 3 : score >= 75 ? 2 : score >= 60 ? 1 : 0, time: run.elapsed, steps: run.scores };
}

// One plain-English tip at a time, from the pilot's point of view, for whichever error is biggest.
export function coach(run: Run, s: DroneState): string {
  const step = run.ex.steps[run.step];
  if (!step) return '';
  const o = offsets(step, s);
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
