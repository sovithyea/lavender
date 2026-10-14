import * as THREE from 'three';
import type { DroneState } from '../shared/physics.ts';

export function buildField(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x9cc4e4);
  scene.fog = new THREE.Fog(0x9cc4e4, 120, 400);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6a2a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshLambertMaterial({ color: 0x5f8f3a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(200, 40, 0x3e6524, 0x4f7a30); // 5 m squares help judge distance
  grid.position.y = 0.01;
  scene.add(grid);

  // Pilot position marker (you stand here in pilot view).
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshBasicMaterial({ color: 0xf2c94c }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.02;
  scene.add(pad);
}

// About 0.5 m across. Front arms red, rear arms dark, like the LED colours you read on a real drone.
export function buildDrone() {
  const drone = new THREE.Group();
  drone.rotation.order = 'YXZ';
  const mat = (color: number) => new THREE.MeshLambertMaterial({ color });
  drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.26), mat(0xf4f4f4)));
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), mat(0x111111));
  cam.position.set(0, -0.06, -0.14);
  drone.add(cam);

  for (const [sx, sz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    const front = sz < 0;
    const tip = new THREE.Vector3(sx * 0.2, 0, sz * 0.2);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.28), mat(front ? 0xd32f2f : 0x333333));
    arm.position.copy(tip).multiplyScalar(0.5);
    arm.lookAt(tip);
    drone.add(arm);
    const rotor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.005, 24),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.25 }),
    );
    rotor.position.set(tip.x, 0.05, tip.z);
    drone.add(rotor);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.025), new THREE.MeshBasicMaterial({ color: front ? 0xff2020 : 0x20ff40 }));
    led.position.set(tip.x, -0.03, tip.z);
    drone.add(led);
  }
  return drone;
}

// A soft blob under the drone: the main depth cue when judging height and distance by eye.
export function buildShadow() {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  return shadow;
}

export function poseDrone(drone: THREE.Object3D, shadow: THREE.Mesh, s: DroneState) {
  drone.position.set(s.pos.x, s.pos.y + 0.06, s.pos.z);
  drone.rotation.set(-s.pitch, -s.yaw, -s.roll);
  shadow.position.set(s.pos.x, 0.03, s.pos.z);
  (shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.max(0.15, 1 - s.pos.y / 40);
}
