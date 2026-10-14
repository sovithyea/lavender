import type { Exercise } from '../shared/exercises.ts';
import type { Sticks } from '../shared/sticks.ts';
import type { createCourse } from './course.ts';
import { clock } from './training.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PLOT_MAX = 3; // error axis top, in multiples of the tolerance

export interface Pose { x: number; y: number; z: number; roll: number; pitch: number; yaw: number; sticks: Sticks; step: number; err: number }
interface Attempt { name: string; score: number; mode: string; exercise: Exercise; samples: number[][] }
// sample: [t, x, y, z, roll, pitch, yaw, throttle, yawStick, pitchStick, rollStick, err, step]

export function createReplay(course: ReturnType<typeof createCourse>, onClose: () => void) {
  let data: Attempt | null = null, t = 0, playing = true, speed = 1;
  const end = () => data!.samples[data!.samples.length - 1][0];

  async function open(file: string) {
    try {
      const res = await fetch(`/api/attempts/${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error(`server said ${res.status}`);
      data = await res.json();
    } catch (e) {
      alert(`Could not load that attempt: ${(e as Error).message}`);
      return;
    }
    if (!data?.samples?.length) { data = null; return; }
    t = 0;
    playing = true;
    course.build(data.exercise);
    $('rpName').textContent = `${data.name} · ${data.score}${data.mode === 'test' ? ' · test' : ''}`;
    $('replay').hidden = false;
  }

  function close() {
    if (!data) return;
    data = null;
    course.clear();
    $('replay').hidden = true;
    onClose();
  }

  const seek = (to: number) => { if (data) t = Math.max(0, Math.min(end(), to)); };
  const toggle = () => {
    if (!data) return;
    if (t >= end()) t = 0;
    playing = !playing;
  };

  $('rpClose').addEventListener('click', close);
  $('rpPlay').addEventListener('click', toggle);
  $('rpSpeed').addEventListener('click', () => {
    speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
    $('rpSpeed').textContent = `${speed}×`;
  });
  $<HTMLInputElement>('rpScrub').addEventListener('input', (e) => seek((Number((e.target as HTMLInputElement).value) / 1000) * end()));
  $('rpPlot').addEventListener('pointerdown', (e) => {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * end());
  });

  // Error over time: green inside the tolerance, red outside, shaded per step, with a playhead.
  function plot() {
    const cv = $<HTMLCanvasElement>('rpPlot'), dpr = devicePixelRatio || 1;
    const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d')!, s = data!.samples, T = end() || 1;
    const X = (time: number) => (time / T) * w, Y = (err: number) => h - (Math.min(err, PLOT_MAX) / PLOT_MAX) * h;
    g.clearRect(0, 0, w, h);
    let start = 0;
    for (let i = 1; i <= s.length; i++) {
      if (i < s.length && s[i][12] === s[start][12]) continue;
      g.fillStyle = s[start][12] % 2 ? 'rgb(255 255 255 / .05)' : 'rgb(255 255 255 / .02)';
      g.fillRect(X(s[start][0]), 0, X(s[Math.min(i, s.length - 1)][0]) - X(s[start][0]), h);
      start = i;
    }
    g.setLineDash([4 * dpr, 4 * dpr]);
    g.strokeStyle = 'rgb(251 191 36 / .7)';
    g.lineWidth = dpr;
    g.beginPath(); g.moveTo(0, Y(1)); g.lineTo(w, Y(1)); g.stroke();
    g.setLineDash([]);
    g.lineWidth = 2 * dpr;
    for (let i = 1; i < s.length; i++) {
      g.strokeStyle = s[i][11] > 1 ? '#f87171' : '#4ade80';
      g.beginPath(); g.moveTo(X(s[i - 1][0]), Y(s[i - 1][11])); g.lineTo(X(s[i][0]), Y(s[i][11])); g.stroke();
    }
    g.fillStyle = '#fff';
    g.fillRect(X(t) - dpr, 0, 2 * dpr, h);
  }

  return {
    active: () => data !== null,
    open,
    close,
    key(k: string): boolean {
      if (!data) return false;
      if (k === 'Escape') close();
      else if (k === ' ') toggle();
      else if (k === 'ArrowLeft') seek(t - 5);
      else if (k === 'ArrowRight') seek(t + 5);
      else return false;
      return true;
    },
    // Advance playback and return the drone pose for this frame.
    frame(dt: number, now: number): Pose | null {
      if (!data) return null;
      const s = data.samples;
      if (playing) { t = Math.min(end(), t + dt * speed); if (t >= end()) playing = false; }
      let lo = 0, hi = s.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid][0] <= t) lo = mid; else hi = mid; }
      const a = s[lo], b = s[hi], f = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 0;
      const mix = (i: number) => a[i] + (b[i] - a[i]) * f;
      const turn = Math.atan2(Math.sin(b[6] - a[6]), Math.cos(b[6] - a[6])); // shortest way round
      const step = a[12], ex = data.exercise;
      course.update(step, mix(11) <= 1, true, now);
      $('rpPlay').textContent = playing ? '❚❚' : '▶';
      $<HTMLInputElement>('rpScrub').value = String(Math.round((t / (end() || 1)) * 1000));
      $('rpTime').textContent = `${clock(t)} / ${clock(end())}`;
      $('rpStep').textContent = ex.steps[step] ? `Step ${step + 1}/${ex.steps.length} · ${ex.steps[step].text}` : 'Finished';
      plot();
      return {
        x: mix(1), y: mix(2), z: mix(3), roll: mix(4), pitch: mix(5), yaw: a[6] + turn * f,
        sticks: { throttle: a[7], yaw: a[8], pitch: a[9], roll: a[10] }, step, err: mix(11),
      };
    },
  };
}
