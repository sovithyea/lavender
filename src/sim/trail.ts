import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Vec3 } from '../shared/physics.ts';

// The drone's flight path: a line that fades from bright (now) to dark (older), so you can see the shape you flew.
const MAX = 1500;         // points kept: about 300 m of path
const SPACING = 0.2;      // m between points
const NEW = new THREE.Color(0xb9adff), OLD = new THREE.Color(0x2a2540);

export function createTrail(scene: THREE.Scene) {
  const pts: Vec3[] = [];
  const geo = new LineGeometry();
  const mat = new LineMaterial({ linewidth: 3, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  let dirty = false;
  const c = new THREE.Color();

  return {
    clear() {
      pts.length = 0;
      line.visible = false;
    },
    // Add the drone's position if it has moved far enough. A jump (reset, replay seek) starts a new trail.
    add(p: Vec3) {
      if (p.y <= 0.05) return; // only while flying
      const last = pts[pts.length - 1];
      const d = last ? Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) : Infinity;
      if (d < SPACING) return;
      if (last && d > 5) pts.length = 0;
      pts.push({ ...p });
      if (pts.length > MAX) pts.shift();
      dirty = true;
    },
    update(enabled: boolean) {
      line.visible = enabled && pts.length > 1;
      if (!line.visible || !dirty) return;
      dirty = false;
      const pos: number[] = [], col: number[] = [];
      pts.forEach((p, i) => {
        pos.push(p.x, p.y, p.z);
        c.lerpColors(OLD, NEW, i / (pts.length - 1));
        col.push(c.r, c.g, c.b);
      });
      line.geometry.dispose(); // LineGeometry can't grow in place, so swap in a fresh one
      line.geometry = new LineGeometry().setPositions(pos).setColors(col);
    },
  };
}
