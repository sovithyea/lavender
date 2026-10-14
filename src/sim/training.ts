import * as THREE from 'three';
import { coach, EXERCISES, result, startRun, updateRun, type Exercise, type Result, type Run, type Step } from '../shared/exercises.ts';
import { DEG, type DroneState } from '../shared/physics.ts';

const NOW = 0xfbbf24, GOOD = 0x4ade80, LATER = 0xffffff;
const $ = (id: string) => document.getElementById(id)!;

// --- score history, kept in this browser only

type History = Record<string, number[]>; // scores per exercise, oldest first
const HKEY = 'trainingHistory';
function loadHistory(): History {
  try {
    const h = JSON.parse(localStorage.getItem(HKEY) ?? '{}');
    return h && typeof h === 'object' ? h : {};
  } catch { return {}; }
}
function saveScore(id: string, score: number) {
  const h = loadHistory();
  h[id] = [...(Array.isArray(h[id]) ? h[id] : []), score].slice(-20);
  try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch { /* not persisted */ }
}
const best = (h: History, id: string) => Math.max(0, ...(h[id] ?? []));
const starCount = (score: number) => (score >= 90 ? 3 : score >= 75 ? 2 : score >= 60 ? 1 : 0);
const stars = (n: number) => `<span class="stars" aria-label="${n} of 3 stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// --- 3D markers

type Marker = { obj: THREE.Object3D; mats: THREE.MeshBasicMaterial[] };
const glow = (opacity = 0.9) => new THREE.MeshBasicMaterial({ color: LATER, transparent: true, opacity, depthWrite: false });

function stepMarker(step: Step, prev: Step | undefined): Marker {
  const g = new THREE.Group(), mats: THREE.MeshBasicMaterial[] = [];
  const add = (geo: THREE.BufferGeometry, opacity: number, setup?: (m: THREE.Mesh) => void) => {
    const mat = glow(opacity), m = new THREE.Mesh(geo, mat);
    mat.userData.base = opacity;
    setup?.(m);
    g.add(m);
    mats.push(mat);
  };
  const { x, y, z } = step.at, r = step.radius;
  if (step.kind === 'land') {
    add(new THREE.RingGeometry(r * 0.82, r, 48).rotateX(-Math.PI / 2), 0.95);
    add(new THREE.CircleGeometry(r * 0.82, 48).rotateX(-Math.PI / 2), 0.18);
    for (const [w, d, px] of [[0.08, 0.5, -0.15], [0.08, 0.5, 0.15], [0.3, 0.08, 0]]) { // an "H"
      add(new THREE.PlaneGeometry(w * r * 2, d * r * 2).rotateX(-Math.PI / 2), 0.9, (m) => { m.position.set(px * r * 2, 0.01, 0); });
    }
    g.position.set(x, 0.1, z);
  } else {
    add(new THREE.CylinderGeometry(0.02, 0.02, y, 6).translate(0, -y / 2, 0), 0.3); // stalk down to the ground: a height cue
    add(new THREE.RingGeometry(r * 0.9, r, 40).rotateX(-Math.PI / 2), 0.25, (m) => { m.position.y = 0.1 - y; });
    if (step.kind === 'hold') {
      add(new THREE.TorusGeometry(r, 0.05, 8, 48).rotateX(Math.PI / 2), 0.95);
      if (step.yaw !== undefined) { // arrow showing which way the nose should point
        add(new THREE.ConeGeometry(0.22, 0.6, 12).rotateX(-Math.PI / 2), 0.95, (m) => { m.position.set(0, 0.9, 0); m.rotation.y = -step.yaw! * DEG; });
      }
    } else {
      add(new THREE.TorusGeometry(r, 0.09, 10, 48), 0.95, (m) => {
        if (prev) m.rotation.y = Math.atan2(x - prev.at.x, z - prev.at.z); // face the way you arrive
      });
    }
    g.position.set(x, y, z);
  }
  return { obj: g, mats };
}

function pole({ x, z }: { x: number; z: number }) {
  const g = new THREE.Group();
  [0xf97316, 0xffffff, 0xf97316].forEach((color, i) => {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2), new THREE.MeshLambertMaterial({ color }));
    seg.position.set(x, 1 + i * 2, z);
    g.add(seg);
  });
  return g;
}

function dispose(o: THREE.Object3D) {
  o.traverse((c) => {
    if (!(c instanceof THREE.Mesh || c instanceof THREE.Line)) return;
    c.geometry.dispose();
    for (const m of [c.material].flat()) m.dispose();
  });
}

// --- the training controller

export interface TrainingHooks {
  start(ex: Exercise): void; // reset the drone for this exercise
  buzz(): void;              // haptic tick on the phone
}

export function createTraining(scene: THREE.Scene, hooks: TrainingHooks) {
  let run: Run | null = null, last: Exercise = EXERCISES[0];
  let markers: Marker[] = [], world: THREE.Group | null = null;

  const clearWorld = () => {
    if (world) { scene.remove(world); dispose(world); }
    world = null;
    markers = [];
  };

  function start(ex: Exercise) {
    clearWorld();
    last = ex;
    run = startRun(ex);
    world = new THREE.Group();
    markers = ex.steps.map((s, i) => stepMarker(s, ex.steps[i - 1]));
    for (const m of markers) world.add(m.obj);
    for (const p of ex.poles ?? []) world.add(pole(p));
    const path = ex.steps.filter((s) => s.kind === 'gate').map((s) => new THREE.Vector3(s.at.x, s.at.y, s.at.z));
    if (path.length > 1) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path),
        new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.45 }));
      line.computeLineDistances();
      world.add(line);
    }
    scene.add(world);
    hide('menu');
    hide('results');
    buildRunCard(ex);
    show('runCard');
    hooks.start(ex);
  }

  function stop() {
    run = null;
    clearWorld();
    hide('runCard');
  }

  function finish(r: Result) {
    const before = best(loadHistory(), last.id);
    saveScore(last.id, r.score);
    hide('runCard');
    showResults(last, r, before);
  }

  // --- DOM

  const show = (id: string) => { $(id).hidden = false; };
  const hide = (id: string) => { $(id).hidden = true; };

  function buildRunCard(ex: Exercise) {
    $('rcName').textContent = ex.name;
    $('rcDots').innerHTML = ex.steps.map(() => '<i></i>').join('');
  }

  function renderMenu() {
    const h = loadHistory();
    const earned = EXERCISES.reduce((n, e) => n + starCount(best(h, e.id)), 0);
    const next = EXERCISES.find((e) => best(h, e.id) < 75) ?? EXERCISES[0];
    $('menuStars').textContent = `${earned} / ${EXERCISES.length * 3}`;
    ($('menuBar') as HTMLElement).style.width = `${(100 * earned) / (EXERCISES.length * 3)}%`;
    $('menuList').innerHTML = EXERCISES.map((e, i) => {
      const runs = h[e.id] ?? [], b = best(h, e.id);
      const spark = runs.slice(-10).map((s) => `<i style="height:${Math.max(6, s)}%"></i>`).join('');
      return `<button class="ex${e === next ? ' next' : ''}" data-id="${e.id}" type="button">
        <span class="ex-top"><span class="ex-num">${i + 1}</span><span class="tag">${e.skill}</span>${e === next ? '<span class="badge">Next up</span>' : ''}</span>
        <span class="ex-name">${e.name}</span>
        <span class="ex-brief">${e.brief}</span>
        <span class="ex-foot">${stars(starCount(b))}<span class="spark">${spark}</span><span class="ex-best">${runs.length ? `Best ${b}` : 'Not tried'}</span></span>
      </button>`;
    }).join('');
  }

  function showResults(ex: Exercise, r: Result, before: number) {
    const weakest = r.steps.indexOf(Math.min(...r.steps));
    const C = 2 * Math.PI * 52;
    $('results').innerHTML = `<div class="panel result" role="dialog" aria-label="Results">
      <div class="eyebrow">${ex.name}</div>
      <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="track"/>
        <circle cx="60" cy="60" r="52" class="fill" style="stroke-dasharray:${(C * r.score) / 100} ${C}"/></svg><b>${r.score}</b></div>
      <div class="big-stars">${stars(r.stars)}</div>
      <div class="pb">${r.score > before ? (before ? `New personal best! Up from ${before}` : 'First score recorded') : `Personal best: ${before}`}</div>
      <div class="stats">
        <div><span>Accuracy</span><b>${r.accuracy}</b></div>
        <div><span>Speed</span><b>${r.speed}</b></div>
        <div><span>Time</span><b>${clock(r.time)}</b></div>
      </div>
      <div class="steps">${ex.steps.map((s, i) => `<div class="srow"><span>${s.text}</span><i><em style="width:${r.steps[i]}%"></em></i><b>${r.steps[i]}</b></div>`).join('')}</div>
      ${r.steps[weakest] < 85 ? `<p class="advice">Work on: <b>${ex.steps[weakest].text.toLowerCase()}</b>. ${advice(ex.steps[weakest])}</p>` : '<p class="advice">Clean flying. Try the next exercise, or beat your time.</p>'}
      <div class="actions"><button class="primary" data-act="retry" type="button">Try again <kbd>Enter</kbd></button>
        <button data-act="menu" type="button">All exercises <kbd>T</kbd></button><button data-act="free" type="button">Free fly <kbd>Esc</kbd></button></div>
    </div>`;
    show('results');
  }

  $('menuList').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
    const ex = EXERCISES.find((x) => x.id === id);
    if (ex) start(ex);
  });
  $('results').addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'retry') start(last);
    if (act === 'menu') openMenu();
    if (act === 'free') hide('results');
  });
  $('menuClose').addEventListener('click', () => hide('menu'));
  $('trainBtn').addEventListener('click', () => openMenu());

  function openMenu() {
    hide('results');
    renderMenu();
    show('menu');
  }

  return {
    exercise: () => run?.ex ?? null,
    start,
    stop,
    openMenu,
    restart: () => { if (run) start(run.ex); },
    // Keys while training: T menu, Enter retry, Esc back out one level.
    key(k: string): boolean {
      const menu = !$('menu').hidden, results = !$('results').hidden;
      if (k === 't' || k === 'T') { if (menu) hide('menu'); else openMenu(); return true; }
      if (k === 'Enter' && results) { start(last); return true; }
      if (k === 'Escape') {
        if (menu) hide('menu');
        else if (results) hide('results');
        else if (run) stop();
        return true;
      }
      return false;
    },
    // Called every physics step.
    tick(s: DroneState, dt: number) {
      if (!run) return;
      const ev = updateRun(run, s, dt);
      if (ev) hooks.buzz();
      if (ev === 'done') {
        const r = result(run);
        stop();
        finish(r);
      }
    },
    // Called every frame: markers and the live coaching card.
    frame(s: DroneState, t: number) {
      if (!run) return;
      const pulse = 1 + 0.05 * Math.sin(t * 5);
      markers.forEach((m, i) => {
        const current = i === run!.step, visible = i >= run!.step && i <= run!.step + 2;
        m.obj.visible = visible;
        m.obj.scale.setScalar(current ? pulse : 1);
        for (const mat of m.mats) {
          mat.color.setHex(current ? (run!.inside ? GOOD : NOW) : LATER);
          mat.opacity = mat.userData.base * (current ? 1 : 0.35);
        }
      });
      const step = run.ex.steps[run.step];
      $('rcTime').textContent = clock(run.elapsed);
      $('rcStep').textContent = `${run.step + 1}/${run.ex.steps.length} · ${step.text}`;
      const tip = $('rcTip');
      tip.textContent = coach(run, s);
      tip.classList.toggle('good', run.inside);
      const bar = $('rcBar');
      bar.hidden = step.kind !== 'hold';
      if (step.kind === 'hold') (bar.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, run.held / step.seconds)})`;
      [...$('rcDots').children].forEach((d, i) => { d.className = i < run!.step ? 'done' : i === run!.step ? 'now' : ''; });
    },
  };
}

function advice(step: Step): string {
  if (step.kind === 'land') return 'Stop above the pad first, check it from the side, then descend slowly and steadily.';
  if (step.kind === 'gate') return 'Keep the throttle steady while you move. Small height changes add up over a long leg.';
  if (step.yaw !== undefined) return 'Turn slowly and pause once the nose lines up. Think about which way the drone will move before you push a stick.';
  return 'Use small, gentle corrections and let the drone settle between them.';
}
