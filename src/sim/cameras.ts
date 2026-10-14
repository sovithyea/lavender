import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SIM } from '../shared/config.ts';
import { DEG } from '../shared/physics.ts';

// Keys 1–5 (and the phone's camera button) switch between these.
export const CAMERAS = ['Pilot', 'Chase', 'Top-down', 'FPV', 'Free orbit'] as const;
const PILOT = new THREE.Vector3(0, SIM.pilotEyeHeight, 0);
const PILOT_FOV = 50;

export function createCameras(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
  let index = 0, snap = true;
  const orbit = new OrbitControls(camera, dom);
  orbit.enabled = false;
  orbit.enableDamping = true;
  const follow = new THREE.Vector3(), ahead = new THREE.Vector3(), want = new THREE.Vector3();

  function select(i: number) {
    index = ((i % CAMERAS.length) + CAMERAS.length) % CAMERAS.length;
    camera.up.set(0, 1, 0);
    orbit.enabled = index === 4;
    snap = true;
  }

  // Place the camera for this frame. Returns the pilot-view zoom factor (1 = no zoom).
  function update(drone: THREE.Object3D, autoZoom: boolean): number {
    const p = drone.position, yaw = drone.rotation.y; // the mesh's rotation.y is minus the drone's heading
    const fwd = ahead.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const ease = snap ? 1 : 0.08;
    drone.visible = index !== 3;
    let fov = 60;

    if (index === 0) {
      // Pilot view: where you stand, always looking at the drone. Auto-zoom keeps it about the size it looks at 20 m.
      camera.position.copy(PILOT);
      camera.lookAt(p);
      const d = PILOT.distanceTo(p);
      fov = autoZoom && d > 20 ? Math.max(10, (2 * Math.atan((Math.tan((PILOT_FOV / 2) * DEG) * 20) / d)) / DEG) : PILOT_FOV;
    } else if (index === 1) {
      // Chase: 5 m behind and a little above, swinging round smoothly as the drone turns.
      want.copy(p).addScaledVector(fwd, -5);
      want.y += 1.8;
      follow.lerp(want, ease);
      camera.position.copy(follow);
      camera.lookAt(want.copy(p).addScaledVector(fwd, 2));
    } else if (index === 2) {
      // Top-down: high overhead with "away from you" at the top of the screen, good for checking shapes.
      want.set(p.x, 45, p.z);
      follow.lerp(want, ease);
      camera.position.copy(follow);
      camera.up.set(0, 0, -1);
      camera.lookAt(follow.x, 0, follow.z);
      fov = 50;
    } else if (index === 3) {
      // FPV: the drone's gimbal camera, held level and turning with the heading.
      camera.position.copy(p).addScaledVector(fwd, 0.15);
      camera.position.y -= 0.04;
      camera.rotation.set(-8 * DEG, yaw, 0, 'YXZ');
      fov = 80;
    } else {
      // Free orbit: drag to look around the drone, scroll to zoom. Starts 6 m back and up, toward the pilot.
      if (snap) camera.position.set(p.x + 2, p.y + 3, p.z + 5);
      orbit.target.lerp(p, snap ? 1 : 0.2);
      orbit.update();
      fov = 55;
    }

    camera.fov = snap ? fov : camera.fov + (fov - camera.fov) * 0.1;
    camera.near = index === 3 ? 0.01 : 0.05; // FPV sits a few cm off the grass when landed
    camera.updateProjectionMatrix();
    snap = false;
    return index === 0 ? PILOT_FOV / camera.fov : 1;
  }

  return { select, next: () => select(index + 1), update, name: () => CAMERAS[index], index: () => index };
}
