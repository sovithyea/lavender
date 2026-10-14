import * as THREE from 'three';
import type { Exercise, Step } from '../shared/exercises.ts';
import { DEG } from '../shared/physics.ts';

// The 3D markers for an exercise: rings to hold in, hoops to fly through, pads to land on, poles to fly round.
const NOW = 0xfbbf24, GOOD = 0x4ade80, LATER = 0xffffff;
type Marker = { obj: THREE.Object3D; mats: THREE.MeshBasicMaterial[] };
const glow = (opacity: number) => {
  const m = new THREE.MeshBasicMaterial({ color: LATER, transparent: true, opacity, depthWrite: false });
  m.userData.base = opacity;
  return m;
};

function stepMarker(step: Step, prev: Step | undefined): Marker {
  const g = new THREE.Group(), mats: THREE.MeshBasicMaterial[] = [];
  const add = (geo: THREE.BufferGeometry, opacity: number, setup?: (m: THREE.Mesh) => void) => {
    const mat = glow(opacity), m = new THREE.Mesh(geo, mat);
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

export function createCourse(scene: THREE.Scene) {
  let world: THREE.Group | null = null, markers: Marker[] = [], path: THREE.Line | null = null;

  function clear() {
    if (!world) return;
    scene.remove(world);
    world.traverse((c) => {
      if (!(c instanceof THREE.Mesh || c instanceof THREE.Line)) return;
      c.geometry.dispose();
      for (const m of [c.material].flat()) m.dispose();
    });
    world = null;
    markers = [];
    path = null;
  }

  function build(ex: Exercise) {
    clear();
    world = new THREE.Group();
    markers = ex.steps.map((s, i) => stepMarker(s, ex.steps[i - 1]));
    for (const m of markers) world.add(m.obj);
    for (const p of ex.poles) world.add(pole(p));
    const pts = ex.steps.filter((s) => s.kind === 'gate').map((s) => new THREE.Vector3(s.at.x, s.at.y, s.at.z));
    if (pts.length > 1) {
      path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.45 }));
      path.computeLineDistances();
      world.add(path);
    }
    scene.add(world);
  }

  // guided: path line, three targets ahead and green feedback. test: just the current and next target.
  function update(step: number, inside: boolean, guided: boolean, t: number) {
    if (path) path.visible = guided;
    const pulse = 1 + 0.05 * Math.sin(t * 5);
    markers.forEach((m, i) => {
      const current = i === step;
      m.obj.visible = i >= step && i <= step + (guided ? 2 : 1);
      m.obj.scale.setScalar(current ? pulse : 1);
      for (const mat of m.mats) {
        mat.color.setHex(current ? (inside && guided ? GOOD : NOW) : LATER);
        mat.opacity = mat.userData.base * (current ? 1 : 0.35);
      }
    });
  }

  return { build, update, clear };
}
