import { describe, expect, it } from 'vitest';
import { mapSticks, sanitizeSticks, type StickMode } from '../src/shared/sticks.ts';

const only = (axis: 'lx' | 'ly' | 'rx' | 'ry') => ({ lx: 0, ly: 0, rx: 0, ry: 0, [axis]: 1 });

describe('mapSticks', () => {
  const expected: Record<StickMode, Record<string, string>> = {
    1: { ly: 'pitch', lx: 'yaw', ry: 'throttle', rx: 'roll' },
    2: { ly: 'throttle', lx: 'yaw', ry: 'pitch', rx: 'roll' },
    3: { ly: 'pitch', lx: 'roll', ry: 'throttle', rx: 'yaw' },
    4: { ly: 'throttle', lx: 'roll', ry: 'pitch', rx: 'yaw' },
  };
  for (const mode of [1, 2, 3, 4] as const) {
    it(`mode ${mode} routes each thumb axis to exactly one control`, () => {
      for (const [axis, control] of Object.entries(expected[mode])) {
        const out = mapSticks(mode, only(axis as 'lx'));
        expect(out).toEqual({ throttle: 0, yaw: 0, pitch: 0, roll: 0, [control]: 1 });
      }
    });
  }
});

describe('sanitizeSticks', () => {
  it('clamps range and zeroes junk', () => {
    expect(sanitizeSticks({ throttle: 5, yaw: -9, pitch: 'x', roll: NaN })).toEqual({ throttle: 1, yaw: -1, pitch: 0, roll: 0 });
    expect(sanitizeSticks(null)).toEqual({ throttle: 0, yaw: 0, pitch: 0, roll: 0 });
  });
});
