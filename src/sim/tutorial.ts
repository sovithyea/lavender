import type { DroneState } from '../shared/physics.ts';
import type { Sticks } from '../shared/sticks.ts';
import { hint, LESSONS, skipStep, startLesson, tickLesson, type Lesson, type LessonRun } from '../shared/tutorials.ts';

const $ = (id: string) => document.getElementById(id)!;
const DONE_KEY = 'lessonsDone';

export interface TutorialHooks {
  start(lesson: Lesson): DroneState; // reset the drone for the lesson and return it
  buzz(): void;
  send(msg: object): void;
  menu(): void;
}

export function createTutorial(hooks: TutorialHooks) {
  let run: LessonRun | null = null, drone: DroneState | null = null, finishedAt = 0, lastStatus = 0;

  const done = (): string[] => {
    try { return JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]'); } catch { return []; }
  };
  const markDone = (id: string) => {
    try { localStorage.setItem(DONE_KEY, JSON.stringify([...new Set([...done(), id])])); } catch { /* not persisted */ }
  };

  function start(lesson: Lesson) {
    drone = hooks.start(lesson);
    run = startLesson(lesson, drone);
    finishedAt = 0;
    $('tutDots').innerHTML = lesson.steps.map(() => '<i></i>').join('');
    $('tutCard').classList.remove('finished');
    $('tutCard').hidden = false;
  }

  function stop() {
    run = null;
    $('tutCard').hidden = true;
    hooks.send({ type: 'status', running: false });
  }

  function advance(ev: 'step' | 'done') {
    hooks.buzz();
    $('tutCard').classList.add('flash');
    setTimeout(() => $('tutCard').classList.remove('flash'), 400);
    if (ev !== 'done' || !run) return;
    markDone(run.lesson.id);
    finishedAt = performance.now();
    const i = LESSONS.indexOf(run.lesson), next = LESSONS[i + 1];
    $('tutCard').classList.add('finished');
    $('tutStep').textContent = `Lesson complete: ${run.lesson.name}`;
    $('tutWhy').textContent = next ? `Next: ${next.name}. ${next.brief}` : 'That is every lesson. Try the exercises next, starting with take-off and hover.';
    $('tutNext').textContent = next ? `Next lesson ▸` : 'Exercises ▸';
    hooks.send({ type: 'result', name: run.lesson.name, score: 100, stars: 3 });
  }

  $('tutSkip').addEventListener('click', () => { if (run && drone && !run.done) advance(skipStep(run, drone)); });
  $('tutQuit').addEventListener('click', stop);
  $('tutNext').addEventListener('click', () => {
    const next = run ? LESSONS[LESSONS.indexOf(run.lesson) + 1] : undefined;
    if (next) start(next);
    else { stop(); hooks.menu(); }
  });

  // Draw one stick of the diagram: where you should push (ring) and where you are (dot), Mode 2 layout.
  const place = (id: string, x = 0, y = 0) => { $(id).style.transform = `translate(${x * 34}px, ${-y * 34}px)`; };

  return {
    lesson: () => (run && !run.done ? run.lesson : null),
    active: () => run !== null,
    start,
    stop,
    lessons: () => LESSONS.map((l) => ({ id: l.id, name: l.name, brief: l.brief, done: done().includes(l.id) })),
    startById(id: unknown) {
      const lesson = LESSONS.find((l) => l.id === id);
      if (lesson) start(lesson);
    },
    key(k: string): boolean {
      if (!run) return false;
      if (k === 'Escape') { stop(); return true; }
      if ((k === 'n' || k === 'N') && drone && !run.done) { advance(skipStep(run, drone)); return true; }
      return false;
    },
    tick(s: DroneState, sticks: Sticks, dt: number) {
      if (!run || run.done) return;
      drone = s;
      const ev = tickLesson(run, s, sticks, dt);
      if (ev) advance(ev);
    },
    frame(s: DroneState, sticks: Sticks, t: number) {
      if (!run) return;
      if (run.done) {
        if (performance.now() - finishedAt > 20000) stop();
        return;
      }
      const step = run.lesson.steps[run.step];
      const want = hint(run, s);
      $('tutName').textContent = `Lesson ${LESSONS.indexOf(run.lesson) + 1} · ${run.lesson.name}`;
      $('tutCount').textContent = `${run.step + 1}/${run.lesson.steps.length}`;
      $('tutStep').textContent = step.text;
      $('tutWhy').textContent = step.why ?? '';
      const hold = step.holdFor ? Math.min(1, run.held / step.holdFor) : 0;
      ($('tutHold').firstElementChild as HTMLElement).style.transform = `scaleX(${hold})`;
      $('tutHold').hidden = !step.holdFor;
      place('tutWantL', want.yaw, want.throttle);
      place('tutWantR', want.roll, want.pitch);
      $('tutWantL').hidden = !want.yaw && !want.throttle;
      $('tutWantR').hidden = !want.roll && !want.pitch;
      place('tutYouL', sticks.yaw, sticks.throttle);
      place('tutYouR', sticks.roll, sticks.pitch);
      [...$('tutDots').children].forEach((d, i) => { d.className = i < run!.step ? 'done' : i === run!.step ? 'now' : ''; });
      if (t - lastStatus > 0.25) {
        lastStatus = t;
        hooks.send({ type: 'status', running: true, name: run.lesson.name, step: run.step + 1, total: run.lesson.steps.length, text: step.text, tip: step.why ?? '', inside: false });
      }
    },
  };
}
