import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManeuvers } from '../src/shared/exercises.ts';

const shipped = JSON.parse(readFileSync(new URL('../config/maneuvers.json', import.meta.url), 'utf8'));

describe('maneuvers.json', () => {
  it('the shipped file is valid', () => {
    const { exercises, errors } = parseManeuvers(shipped);
    expect(errors).toEqual([]);
    expect(exercises.length).toBe(shipped.length);
  });

  it('converts pilot-relative z (away from you) to the world frame', () => {
    const [ex] = parseManeuvers([{ id: 'a', name: 'A', par: 10, steps: [{ hold: [2, 3, 10], seconds: 1, text: 'h' }] }]).exercises;
    expect(ex.steps[0].at).toEqual({ x: 2, y: 3, z: -10 });
  });

  it('expands an arc into evenly spaced gates ending where the sweep ends', () => {
    const { exercises } = parseManeuvers([{ id: 'o', name: 'O', par: 10, steps: [
      { arc: { center: [0, 30], radius: 10, from: 180, sweep: 360, y: 5, gates: 4 }, text: 'Orbit' },
    ] }]);
    const pts = exercises[0].steps.map((s) => [Math.round(s.at.x) + 0, s.at.y, Math.round(-s.at.z) + 0]);
    expect(pts).toEqual([[-10, 5, 30], [0, 5, 40], [10, 5, 30], [0, 5, 20]]); // left, far, right, back to near
    expect(exercises[0].steps[3].text).toBe('Orbit (4/4)');
  });

  it('applies tolerance defaults and per-step overrides', () => {
    const [ex] = parseManeuvers([{ id: 't', name: 'T', par: 10, tolerance: { lateral: 2, vertical: 1.5 }, steps: [
      { gate: [0, 3, 10], text: 'g' }, { hold: [0, 3, 10], seconds: 1, radius: 0.5, text: 'h' },
    ] }]).exercises;
    expect(ex.steps[0]).toMatchObject({ radius: 2, lateral: 2, vertical: 1.5 });
    expect(ex.steps[1]).toMatchObject({ radius: 0.5, height: 1.5 });
  });

  it('reports errors with the exact path to the problem', () => {
    const { exercises, errors } = parseManeuvers([
      { id: 'ok', name: 'OK', par: 10, steps: [{ land: [0, 0, 10], text: 'Land' }] },
      { id: 'bad', name: 'Bad', par: -1, flightMode: 'sport', steps: [
        { hold: [0, 3], seconds: 2, text: 'h' },
        { gate: [0, 3, 10] },
        { land: [0, 2, 10], text: 'l' },
        { hold: [0, 3, 10], gate: [0, 3, 10], text: 'both' },
      ] },
      { id: 'ok', name: 'Dup', par: 10, steps: [] },
    ]);
    expect(exercises.map((e) => e.id)).toEqual(['ok']);
    expect(errors).toEqual(expect.arrayContaining([
      'maneuvers[1] ("bad").par: expected a number above 0',
      'maneuvers[1] ("bad").flightMode: expected "stabilised" or "attitude"',
      'maneuvers[1] ("bad").steps[0].hold: expected [x, y, z] numbers',
      'maneuvers[1] ("bad").steps[1].text: expected a non-empty string',
      'maneuvers[1] ("bad").steps[2].land: landing points are on the ground: y must be 0',
      'maneuvers[1] ("bad").steps[3]: needs exactly one of "hold", "gate", "land" or "arc"',
      'maneuvers[2] ("ok").id: duplicate id "ok"',
      'maneuvers[2] ("ok").steps: expected a non-empty array of steps',
    ]));
    expect(parseManeuvers({}).errors).toEqual(['maneuvers.json: expected an array of maneuvers']);
  });
});
