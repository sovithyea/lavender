import type * as THREE from 'three';
import { coach, result, stars as starsFor, startRun, updateRun, type Exercise, type Mode, type Result, type Run, type Step } from '../shared/exercises.ts';
import type { DroneState } from '../shared/physics.ts';
import type { Sticks } from '../shared/sticks.ts';
import { createCourse } from './course.ts';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const stars = (n: number) => `<span class="stars" aria-label="${n} of 3 stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// What the server keeps for each finished attempt (the full file also holds the exercise and the samples).
export interface AttemptSummary {
  file: string; exerciseId: string; name: string; mode: Mode; score: number; accuracy: number; speed: number;
  smoothness: number; breaches: number; stars: number; time: number; date: string;
}

export interface TrainingHooks {
  start(ex: Exercise): void;                 // reset the drone for this exercise
  buzz(): void;                              // haptic tick on the phone
  send(msg: object): void;                   // message to the phone
  replay(file: string): void;                // open a saved attempt in the replay viewer
}

export function createTraining(scene: THREE.Scene, hooks: TrainingHooks) {
  const course = createCourse(scene);
  let exercises: Exercise[] = [], errors: string[] = [], history: AttemptSummary[] = [];
  let run: Run | null = null, last: Exercise | null = null, lastStatus = 0;
  let mode: Mode = 'guided';
  try { if (localStorage.getItem('trainingMode') === 'test') mode = 'test'; } catch { /* default */ }

  // Exercises are re-read from config/maneuvers.json every time, so edits show up without a restart.
  async function load() {
    try {
      const [m, h] = await Promise.all([fetch('/api/maneuvers').then((r) => r.json()), fetch('/api/attempts').then((r) => r.json())]);
      exercises = m.exercises;
      errors = m.errors;
      history = h;
    } catch (e) {
      errors = [`Could not reach the server: ${(e as Error).message}`];
    }
    hooks.send({ type: 'maneuvers', list: exercises.map((e) => ({ id: e.id, name: e.name })), mode });
    if (!$('menu').hidden) renderMenu();
  }

  function start(ex: Exercise, m = mode) {
    last = ex;
    run = startRun(ex, m);
    course.build(ex);
    hide('menu');
    hide('results');
    $('rcName').textContent = `${ex.name}${m === 'test' ? ' · test' : ''}`;
    $('rcDots').innerHTML = ex.steps.map(() => '<i></i>').join('');
    $('runCard').classList.toggle('test', m === 'test');
    show('runCard');
    hooks.start(ex);
  }

  function stop() {
    run = null;
    course.clear();
    hide('runCard');
    hooks.send({ type: 'status', running: false });
  }

  async function finish(done: Run, r: Result) {
    const best = bestOf(done.ex.id);
    showResults(done.ex, done.mode, r, best);
    hooks.send({ type: 'result', name: done.ex.name, score: r.score, stars: r.stars });
    const attempt = {
      exerciseId: done.ex.id, name: done.ex.name, mode: done.mode, ...r, date: new Date().toISOString(),
      exercise: done.ex, samples: done.samples,
    };
    try {
      const res = await fetch('/api/attempts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(attempt) });
      if (!res.ok) throw new Error(`server said ${res.status}`);
      const summary: AttemptSummary = await res.json();
      history.push(summary);
      const btn = document.querySelector<HTMLButtonElement>('#results [data-act="replay"]');
      if (btn) { btn.dataset.file = summary.file; btn.disabled = false; }
    } catch (e) {
      $('saveNote').textContent = `Not saved: ${(e as Error).message}`;
    }
  }

  // --- DOM

  const show = (id: string) => { $(id).hidden = false; };
  const hide = (id: string) => { $(id).hidden = true; };
  const runsOf = (id: string) => history.filter((h) => h.exerciseId === id);
  const bestOf = (id: string) => Math.max(0, ...runsOf(id).map((h) => h.score));

  function renderMenu() {
    const earned = exercises.reduce((n, e) => n + starsFor(bestOf(e.id)), 0);
    const next = exercises.find((e) => bestOf(e.id) < 75) ?? exercises[0];
    $('menuStars').textContent = `${earned} / ${exercises.length * 3}`;
    $('menuBar').style.width = `${exercises.length ? (100 * earned) / (exercises.length * 3) : 0}%`;
    for (const b of document.querySelectorAll<HTMLElement>('#modeSwitch [data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    $('menuErrors').hidden = !errors.length;
    $('menuErrors').innerHTML = `<b>config/maneuvers.json has problems</b> (fix the file and reopen this menu):<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
    $('menuList').innerHTML = exercises.map((e, i) => {
      const runs = runsOf(e.id), b = bestOf(e.id);
      const spark = runs.slice(-12).map((r) => `<i class="${r.mode}" style="height:${Math.max(6, r.score)}%" title="${r.score}"></i>`).join('');
      return `<button class="ex${e === next ? ' next' : ''}" data-id="${esc(e.id)}" type="button">
        <span class="ex-top"><span class="ex-num">${i + 1}</span><span class="tag">${esc(e.skill)}</span>${e === next ? '<span class="badge">Next up</span>' : ''}</span>
        <span class="ex-name">${esc(e.name)}</span>
        <span class="ex-brief">${esc(e.brief)}</span>
        <span class="ex-foot">${stars(starsFor(b))}<span class="spark">${spark}</span><span class="ex-best">${runs.length ? `Best ${b}` : 'Not tried'}</span></span>
      </button>`;
    }).join('');
    const recent = history.slice(-8).reverse();
    $('recent').innerHTML = recent.length ? `<h3>Recent attempts</h3>${recent.map((h) => `
      <div class="attempt"><span>${new Date(h.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
        <b>${esc(h.name)}</b><span class="mode-tag ${h.mode}">${h.mode}</span>${stars(h.stars)}<b>${h.score}</b>
        <button data-replay="${esc(h.file)}" type="button">▶ Replay</button></div>`).join('')}` : '';
  }

  function showResults(ex: Exercise, m: Mode, r: Result, before: number) {
    const weakest = r.steps.indexOf(Math.min(...r.steps));
    const C = 2 * Math.PI * 52;
    $('results').innerHTML = `<div class="panel result" role="dialog" aria-label="Results">
      <div class="eyebrow">${esc(ex.name)}${m === 'test' ? ' · test' : ''}</div>
      <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="track"/>
        <circle cx="60" cy="60" r="52" class="fill" style="stroke-dasharray:${(C * r.score) / 100} ${C}"/></svg><b>${r.score}</b></div>
      <div class="big-stars">${stars(r.stars)}</div>
      <div class="pb">${r.score > before ? (before ? `New personal best! Up from ${before}` : 'First score recorded') : `Personal best: ${before}`}</div>
      <div class="stats">
        <div><span>Accuracy</span><b>${r.accuracy}</b></div>
        <div><span>Speed</span><b>${r.speed}</b></div>
        <div><span>Smooth</span><b>${r.smoothness}</b></div>
        <div><span>Time</span><b>${clock(r.time)}</b></div>
      </div>
      ${r.breaches ? `<p class="breach">${r.breaches} boundary or height breach${r.breaches > 1 ? 'es' : ''}: −${r.breaches * 10}</p>` : ''}
      <div class="steps">${ex.steps.map((s, i) => `<div class="srow"><span>${esc(s.text)}</span><i><em style="width:${r.steps[i]}%"></em></i><b>${r.steps[i]}</b></div>`).join('')}</div>
      ${r.steps[weakest] < 85 ? `<p class="advice">Work on: <b>${esc(ex.steps[weakest].text.toLowerCase())}</b>. ${advice(ex.steps[weakest])}</p>`
        : r.smoothness < 70 ? '<p class="advice">Accurate, but busy on the sticks. Try smaller, slower inputs.</p>'
        : '<p class="advice">Clean flying. Try the next exercise, or beat your time.</p>'}
      <div class="actions"><button class="primary" data-act="retry" type="button">Try again <kbd>Enter</kbd></button>
        <button data-act="replay" type="button" disabled>▶ Replay</button>
        <button data-act="menu" type="button">All exercises <kbd>T</kbd></button><button data-act="free" type="button">Free fly <kbd>Esc</kbd></button></div>
      <p id="saveNote" class="note"></p>
    </div>`;
    show('results');
  }

  $('menuList').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
    const ex = exercises.find((x) => x.id === id);
    if (ex) start(ex);
  });
  $('recent').addEventListener('click', (e) => {
    const file = (e.target as HTMLElement).closest<HTMLElement>('[data-replay]')?.dataset.replay;
    if (file) { hide('menu'); hooks.replay(file); }
  });
  $('modeSwitch').addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode;
    if (m === 'guided' || m === 'test') setMode(m);
  });
  $('results').addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (el?.dataset.act === 'retry' && last) start(last);
    if (el?.dataset.act === 'menu') openMenu();
    if (el?.dataset.act === 'free') hide('results');
    if (el?.dataset.act === 'replay' && el.dataset.file) { hide('results'); hooks.replay(el.dataset.file); }
  });
  $('menuClose').addEventListener('click', () => hide('menu'));
  $('trainBtn').addEventListener('click', () => openMenu());

  function setMode(m: Mode) {
    mode = m;
    try { localStorage.setItem('trainingMode', m); } catch { /* not persisted */ }
    renderMenu();
    hooks.send({ type: 'mode', mode });
  }

  function openMenu() {
    hide('results');
    renderMenu();
    show('menu');
    void load();
  }

  void load();

  return {
    exercise: () => run?.ex ?? null,
    load,
    openMenu,
    stop,
    restart: () => { if (run) start(run.ex, run.mode); },
    // From the phone: start an exercise by id, in a given mode.
    startById(id: unknown, m: unknown) {
      const ex = exercises.find((e) => e.id === id);
      if (!ex) return;
      if (m === 'guided' || m === 'test') setMode(m);
      start(ex, mode);
    },
    // Keys while training: T menu, Enter retry, Esc back out one level.
    key(k: string): boolean {
      const menu = !$('menu').hidden, results = !$('results').hidden;
      if (k === 't' || k === 'T') { if (menu) hide('menu'); else openMenu(); return true; }
      if (k === 'Enter' && results && last) { start(last); return true; }
      if (k === 'Escape') {
        if (menu) hide('menu');
        else if (results) hide('results');
        else if (run) stop();
        else return false;
        return true;
      }
      return false;
    },
    // Called every physics step.
    tick(s: DroneState, sticks: Sticks, dt: number) {
      if (!run) return;
      const ev = updateRun(run, s, sticks, dt);
      if (ev) hooks.buzz();
      if (ev === 'done') {
        const done = run;
        stop();
        void finish(done, result(done));
      }
    },
    // Called every frame: markers, the live coaching card and the phone's status line.
    frame(s: DroneState, t: number) {
      if (!run) return;
      const guided = run.mode === 'guided';
      course.update(run.step, run.inside, guided, t);
      const step = run.ex.steps[run.step];
      const tip = guided ? coach(run, s) : '';
      $('rcTime').textContent = clock(run.elapsed);
      $('rcStep').textContent = `${run.step + 1}/${run.ex.steps.length} · ${step.text}`;
      $('rcTip').textContent = tip;
      $('rcTip').classList.toggle('good', run.inside);
      const bar = $('rcBar');
      bar.hidden = step.kind !== 'hold';
      if (step.kind === 'hold') (bar.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, run.held / step.seconds)})`;
      // Live error against the tolerance: inside the green zone is within tolerance.
      $('rcErr').style.transform = `scaleX(${Math.min(1, run.err / 2)})`;
      $('rcErr').classList.toggle('over', run.err > 1);
      const sofar = run.scores.length ? Math.round(run.scores.reduce((a, b) => a + b, 0) / run.scores.length) : null;
      $('rcScore').textContent = sofar === null ? '' : `Accuracy so far ${sofar}`;
      [...$('rcDots').children].forEach((d, i) => { d.className = i < run!.step ? 'done' : i === run!.step ? 'now' : ''; });
      if (t - lastStatus > 0.25) {
        lastStatus = t;
        hooks.send({ type: 'status', running: true, name: run.ex.name, step: run.step + 1, total: run.ex.steps.length, text: step.text, tip, inside: run.inside });
      }
    },
  };
}

function advice(step: Step): string {
  if (step.kind === 'land') return 'Stop above the pad first, check it from the side, then descend slowly and steadily.';
  if (step.kind === 'gate') return 'Line up on the next hoop before you go, and keep the throttle steady while you move. Small drifts add up over a long leg.';
  if (step.yaw !== undefined) return 'Turn slowly and pause once the nose lines up. Think about which way the drone will move before you push a stick.';
  return 'Use small, gentle corrections and let the drone settle between them.';
}
