import type { FlightParams } from './config.ts';
import { DEG, forwardOf, rightOf, type DroneState, type Vec3 } from './physics.ts';
import type { Sticks } from './sticks.ts';

// Step-by-step lessons. Each step waits until you have actually done the thing it asks.
// `demo` is the stick input the step asks for: the sim draws it on the stick diagram,
// and the tests fly every lesson with exactly these inputs to prove the instructions are right.

export interface Snapshot { pos: Vec3; yaw: number }
export interface LessonStep {
  text: string;                  // what to do
  why?: string;                  // a line of explanation
  demo?: Partial<Sticks>;        // the input to use (Mode 2 names: throttle/yaw = left stick, pitch/roll = right stick)
  heading?: number;              // deg: steps that ask you to turn to a heading steer the diagram live
  holdFor?: number;              // s the condition must stay true
  done(s: DroneState, start: Snapshot, sticks: Sticks): boolean;
}
export interface Lesson {
  id: string;
  name: string;
  brief: string;
  params?: Partial<FlightParams>;
  wind?: { speed: number; from: number; gusts: number };
  steps: LessonStep[];
}

const PAD = { x: 0, z: -10 };
const gs = (s: DroneState) => Math.hypot(s.vel.x, s.vel.z);
const centred = (k: Sticks) => Math.max(Math.abs(k.throttle), Math.abs(k.yaw), Math.abs(k.pitch), Math.abs(k.roll)) < 0.05;
const headingErr = (s: DroneState, deg: number) => ((deg - s.yaw / DEG + 540) % 360) - 180;
const facing = (deg: number) => (s: DroneState) => Math.abs(headingErr(s, deg)) < 15;
// How far the drone has moved since the step began, along its own forward or right at that moment.
const along = (s: DroneState, a: Snapshot, dir: 'fwd' | 'right') => {
  const v = (dir === 'fwd' ? forwardOf : rightOf)(a.yaw);
  return (s.pos.x - a.pos.x) * v.x + (s.pos.z - a.pos.z) * v.z;
};
const landed = (s: DroneState, a: Snapshot) => a.pos.y > 0.3 && s.pos.y === 0;
const takeOff = (why?: string): LessonStep => ({
  text: 'Take off: push the left stick up until the drone is about 3 m up', why, demo: { throttle: 0.6 },
  done: (s) => s.pos.y > 2.5,
});
const land = (text = 'Land: pull the left stick down gently until it touches down'): LessonStep => ({
  text, demo: { throttle: -0.5 }, done: (s, a) => landed(s, a),
});

export const LESSONS: Lesson[] = [
  {
    id: 'first-flight', name: 'First flight', brief: 'Meet each stick one at a time: climb, turn, forward, back, sideways and land.',
    steps: [
      takeOff('The left stick up and down is the throttle: it sets how fast you climb or sink.'),
      { text: 'Let go of both sticks', why: 'Centred sticks brake and hold the drone still. Letting go is always a safe move.',
        holdFor: 2, done: (s, _a, k) => s.pos.y > 0.5 && centred(k) && gs(s) < 0.3 },
      { text: 'Yaw right: push the left stick right until the nose has turned a quarter turn', why: 'Yaw turns the drone on the spot without moving it.',
        demo: { yaw: 0.6 }, done: (s, a) => headingErr(s, a.yaw / DEG) < -80 },
      { text: 'Yaw back: left stick left until the nose points away from you again', demo: { yaw: -0.5 }, heading: 0, holdFor: 0.5, done: facing(0) },
      { text: 'Pitch: push the right stick up to fly forward about 5 m', why: '"Forward" is wherever the nose points.',
        demo: { pitch: 0.6 }, done: (s, a) => along(s, a, 'fwd') > 5 },
      { text: 'Pull the right stick down to fly back toward you about 5 m', demo: { pitch: -0.6 }, done: (s, a) => along(s, a, 'fwd') < -5 },
      { text: 'Roll: push the right stick right to slide right about 4 m', demo: { roll: 0.6 }, done: (s, a) => along(s, a, 'right') > 4 },
      { text: 'Right stick left to slide back left about 4 m', demo: { roll: -0.6 }, done: (s, a) => along(s, a, 'right') < -4 },
      land(),
    ],
  },
  {
    id: 'orientation', name: 'Orientation', brief: 'Fly with the nose facing you and to the side, when the sticks feel reversed.',
    steps: [
      takeOff(),
      { text: 'Yaw until the nose faces you', why: 'Look for the red lights: they are on the front arms.',
        demo: { yaw: 0.6 }, heading: 180, holdFor: 1, done: facing(180) },
      { text: 'Fly to YOUR left about 4 m', why: 'Nose-in, the drone\'s right is your left: push the right stick RIGHT.',
        demo: { roll: 0.6 }, done: (s, a) => s.pos.x - a.pos.x < -4 },
      { text: 'Fly toward yourself about 4 m', why: 'Nose-in, forward is toward you: push the right stick UP.',
        demo: { pitch: 0.6 }, done: (s, a) => s.pos.z - a.pos.z > 4 },
      { text: 'Yaw until the nose points to your right', demo: { yaw: -0.6 }, heading: 90, holdFor: 1, done: facing(90) },
      { text: 'Fly away from you about 4 m', why: 'Nose to your right, the drone\'s left is away from you: push the right stick LEFT.',
        demo: { roll: -0.6 }, done: (s, a) => s.pos.z - a.pos.z < -4 },
      land(),
    ],
  },
  {
    id: 'attitude', name: 'Attitude mode', brief: 'No GPS hold and a 3 m/s wind from your right: feel the drift and learn to catch it.',
    params: { mode: 'attitude' },
    wind: { speed: 3, from: 90, gusts: 0 },
    steps: [
      takeOff('In attitude mode only the height is held. Nothing holds the position.'),
      { text: 'Let go and watch the drone drift to your left', why: 'The wind blows it along. This is what happens with no GPS.',
        done: (s, a) => s.pos.x - a.pos.x < -3 },
      { text: 'Stop the drift: hold the right stick a little to the right, into the wind', why: 'Small, early corrections work best. Ease off as it slows.',
        demo: { roll: 0.17 }, holdFor: 2, done: (s) => gs(s) < 0.6 },
      { text: 'Fly back over the pad', why: 'Push a little more to the right than it takes to hold still.',
        demo: { roll: 0.35 }, done: (s) => Math.hypot(s.pos.x - PAD.x, s.pos.z - PAD.z) < 2.5 },
      land('Land: left stick down, and keep correcting the drift as you come down'),
    ],
  },
];

// --- running a lesson

export interface LessonRun { lesson: Lesson; step: number; start: Snapshot; held: number; done: boolean }
const snap = (s: DroneState): Snapshot => ({ pos: { ...s.pos }, yaw: s.yaw });

export const startLesson = (lesson: Lesson, s: DroneState): LessonRun => ({ lesson, step: 0, start: snap(s), held: 0, done: false });

// Advance by one physics step. Returns 'step' when a step is done and 'done' at the end of the lesson.
export function tickLesson(run: LessonRun, s: DroneState, sticks: Sticks, dt: number): 'step' | 'done' | null {
  if (run.done) return null;
  const step = run.lesson.steps[run.step];
  run.held = step.done(s, run.start, sticks) ? run.held + dt : 0;
  if (run.held < (step.holdFor ?? 0) || run.held === 0) return null;
  return skipStep(run, s);
}

export function skipStep(run: LessonRun, s: DroneState): 'step' | 'done' {
  run.step++;
  run.start = snap(s);
  run.held = 0;
  if (run.step < run.lesson.steps.length) return 'step';
  run.done = true;
  return 'done';
}

// The input to show on the stick diagram right now: a heading step points the yaw stick the short way round.
export function hint(run: LessonRun, s: DroneState): Partial<Sticks> {
  const step = run.lesson.steps[run.step];
  if (!step) return {};
  if (step.heading !== undefined) {
    const e = headingErr(s, step.heading);
    return Math.abs(e) < 15 ? {} : { yaw: e > 0 ? 0.6 : -0.6 };
  }
  return step.demo ?? {};
}
