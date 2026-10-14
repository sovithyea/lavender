import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/shared/config.ts';
import { createState, step, windFrom } from '../src/shared/physics.ts';
import { NEUTRAL } from '../src/shared/sticks.ts';
import { hint, LESSONS, startLesson, tickLesson } from '../src/shared/tutorials.ts';

const DT = 1 / 120;

describe('tutorials', () => {
  // Fly each lesson using only the input each step tells you to use. If an instruction pointed the wrong way
  // (say "right stick right" when nose-in actually needs left), that step would never finish.
  for (const lesson of LESSONS) {
    it(`${lesson.name}: following the instructions completes every step`, () => {
      const p = { ...PRESETS.agile.params, ...lesson.params };
      const wind = lesson.wind ? windFrom(lesson.wind.speed, lesson.wind.from) : { x: 0, y: 0, z: 0 };
      const s = createState({ x: 0, y: 0, z: -10 }, 0);
      const run = startLesson(lesson, s);
      const stepTimes: number[] = [];
      let t = 0;
      for (let i = 0; i < 200 / DT && !run.done; i++) {
        const sticks = { ...NEUTRAL, ...hint(run, s) };
        step(s, sticks, p, wind, DT);
        t += DT;
        if (tickLesson(run, s, sticks, DT)) { stepTimes.push(t); t = 0; }
      }
      expect(run.done, `stuck on step ${run.step + 1}: ${lesson.steps[run.step]?.text}`).toBe(true);
      for (const time of stepTimes) expect(time).toBeLessThan(30); // each step is quick when done as described
    });
  }

  it('a step that needs a hold resets if you stop doing it', () => {
    const lesson = LESSONS[0];
    const s = createState({ x: 0, y: 3, z: -10 }, 0);
    const run = startLesson(lesson, s);
    run.step = 1; // "Let go of both sticks", held for 2 s
    for (let i = 0; i < 120; i++) tickLesson(run, s, NEUTRAL, DT); // 1 s
    tickLesson(run, s, { ...NEUTRAL, roll: 0.5 }, DT);
    expect(run.held).toBe(0);
    expect(run.step).toBe(1);
  });
});
