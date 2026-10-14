import * as THREE from 'three';
import type { DroneState } from '../shared/physics.ts';

// World frame: x = pilot's right, y = up, -z = away from the pilot, who stands at the origin.
export const LOCATIONS = { field: 'Farm paddock', park: 'Town park', beach: 'Beach' } as const;
export type Location = keyof typeof LOCATIONS;

type Pt = [number, number];
const HORIZON = 0xd4e4ee, ZENITH = 0x3f7cc4;
const GROUND = 1600; // m across; the sky dome (900 m radius) and fog hide the edge

// Seeded so every location looks the same each time you open it.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sky, light, pilot pad and the optional distance grid: the same at every location.
export function buildWorld(scene: THREE.Scene) {
  scene.fog = new THREE.Fog(HORIZON, 200, 750);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6a3a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  // Sky dome: hazy at the horizon, deep blue overhead.
  const sky = new THREE.SphereGeometry(900, 32, 16);
  const pos = sky.attributes.position, colors: number[] = [];
  const h = new THREE.Color(HORIZON), z = new THREE.Color(ZENITH), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.lerpColors(h, z, Math.sqrt(Math.max(0, pos.getY(i) / 900)));
    colors.push(c.r, c.g, c.b);
  }
  sky.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));

  // Pilot position marker (you stand here in pilot view).
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshBasicMaterial({ color: 0xf2c94c }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.05;
  scene.add(pad);

  // 5 m squares help judge distance; a switch in Settings because it looks unreal.
  const grid = new THREE.GridHelper(200, 40, 0x2f4f1c, 0x2f4f1c);
  Object.assign(grid.material, { transparent: true, opacity: 0.35 });
  grid.position.y = 0.06;
  scene.add(grid);
  return grid;
}

export function buildLocation(loc: Location): THREE.Group {
  const g = new THREE.Group(), r = rng(loc.length * 97 + 13);
  if (loc === 'field') {
    g.add(ground(grassTexture(r, true), 0.18, r));
    const paddock: Pt[] = [[-90, 40], [90, 40], [90, -160], [-90, -160]];
    g.add(fence(paddock));
    const treeLine: Pt[] = [[-108, 58], [108, 58], [108, -178], [-108, -178]]; // 18 m outside the fence
    const edge = treeLine.flatMap((p, i) => line(p, treeLine[(i + 1) % 4], 7, r)).map(([x, z]): Pt => [x + (r() - 0.5) * 12, z + (r() - 0.5) * 12]);
    const outside = ring(90, 150, 380, r).filter(([x, z]) => !(Math.abs(x) < 110 && z < 60 && z > -180));
    g.add(trees([...edge, ...outside], r, [0x4f6b3a, 0x5d7a45, 0x6b7f4a, 0x45603a]));
    g.add(bales([[-25, -30], [-22, -32], [30, -55], [-40, -75], [15, -95], [45, -20]], r));
    g.add(houses([[-130, -120], [-118, -140]], r));
    g.add(hills(r, 0, 2 * Math.PI, 0x6f8a5c));
  } else if (loc === 'park') {
    g.add(ground(grassTexture(r, true), 0.12, r));
    g.add(goal(-55), goal(35));
    const scattered = ring(70, 50, 150, r).filter(([x, z]) => !(Math.abs(x) < 45 && z < 45 && z > -75));
    g.add(trees(scattered, r, [0x3f6b35, 0x4e7a3c, 0x5c8a45, 0x6a7a40]));
    g.add(houses(ring(70, 160, 260, r), r));
    g.add(hills(r, 0, 2 * Math.PI, 0x7a8f6a));
  } else {
    g.add(ground(sandTexture(r), 0.08, r));
    g.add(sea(r));
    const palms = Array.from({ length: 40 }, (): Pt => [(r() - 0.5) * 240, 25 + r() * 60]);
    g.add(trees(palms, r, [0x4a7a3a, 0x5a8a40, 0x3e6e34], true));
    g.add(houses(Array.from({ length: 30 }, (): Pt => [(r() - 0.5) * 360, 100 + r() * 80]), r));
    g.add(hills(r, Math.PI / 2, 1.5 * Math.PI, 0x7d8c6c));
  }
  return g;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    if (!(c instanceof THREE.Mesh)) return;
    c.geometry.dispose();
    for (const m of [c.material].flat() as THREE.MeshBasicMaterial[]) { m.map?.dispose(); m.dispose(); }
  });
}

// --- ground

function canvasTexture(draw: (g: CanvasRenderingContext2D, size: number) => void, metres: number) {
  const size = 512, cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16; // three.js clamps this to what the GPU supports
  tex.repeat.set(GROUND / metres, GROUND / metres);
  return tex;
}

const speckle = (g: CanvasRenderingContext2D, size: number, r: () => number, colors: string[], n: number) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 3);
  }
};

// One tile is 10 m: two 5 m mowing stripes running away from the pilot, a natural distance cue.
const grassTexture = (r: () => number, stripes: boolean) => canvasTexture((g, size) => {
  g.fillStyle = '#5b8a37';
  g.fillRect(0, 0, size, size);
  if (stripes) { g.fillStyle = 'rgb(255 255 255 / .08)'; g.fillRect(0, 0, size / 2, size); }
  speckle(g, size, r, ['rgb(40 70 20 / .5)', 'rgb(110 150 60 / .5)', 'rgb(80 110 40 / .6)', 'rgb(150 160 80 / .3)'], 14000);
}, 10);

const sandTexture = (r: () => number) => canvasTexture((g, size) => {
  g.fillStyle = '#d8c296';
  g.fillRect(0, 0, size, size);
  speckle(g, size, r, ['rgb(170 140 100 / .4)', 'rgb(240 225 190 / .5)', 'rgb(140 120 90 / .3)'], 10000);
}, 6);

// Low-frequency colour patches (about 16 m) so the ground is not one flat repeat.
function ground(tex: THREE.Texture, patchiness: number, r: () => number) {
  const geo = new THREE.PlaneGeometry(GROUND, GROUND, 100, 100).rotateX(-Math.PI / 2);
  const colors = Array.from({ length: geo.attributes.position.count }, () => {
    const v = 1 - patchiness * r();
    return [v, v, v * (0.95 + r() * 0.05)];
  }).flat();
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
}

function sea(r: () => number) {
  const g = new THREE.Group();
  const strip = (depth: number, z: number, y: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, depth).rotateX(-Math.PI / 2), mat);
    m.position.set(0, y, z);
    g.add(m);
    return m;
  };
  strip(10, -45, 0.02, new THREE.MeshLambertMaterial({ color: 0xb09466 }));                                   // wet sand
  // Wave streaks on an 8 m tile, drifting slowly toward the shore.
  const waves = canvasTexture((c, size) => {
    c.fillStyle = '#2f7398';
    c.fillRect(0, 0, size, size);
    for (let i = 0; i < 4000; i++) {
      c.fillStyle = r() < 0.5 ? 'rgb(255 255 255 / .12)' : 'rgb(10 40 70 / .2)';
      c.fillRect(r() * size, r() * size, 4 + r() * 20, 1 + r());
    }
  }, 8);
  const water = strip(GROUND / 2, -50 - GROUND / 4, 0.04, new THREE.MeshPhongMaterial({ map: waves, specular: 0x88aabb, shininess: 60 }));
  water.onBeforeRender = () => { waves.offset.y = -performance.now() / 50000; };
  strip(3, -51, 0.05, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));     // surf line
  return g;
}

// --- scenery

function line([x0, z0]: Pt, [x1, z1]: Pt, spacing: number, r: () => number): Pt[] {
  const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / spacing);
  return Array.from({ length: n }, (_, i) => {
    const t = (i + r() * 0.5) / n;
    return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
  });
}

// Points between two distances from the pilot, over an arc (0 = straight ahead, clockwise).
function ring(n: number, near: number, far: number, r: () => number, a0 = 0, a1 = 2 * Math.PI): Pt[] {
  return Array.from({ length: n }, () => {
    const a = a0 + r() * (a1 - a0), d = near + r() * (far - near);
    return [Math.sin(a) * d, -Math.cos(a) * d];
  });
}

const dummy = new THREE.Object3D();
function instances(geo: THREE.BufferGeometry, mat: THREE.Material, pts: Pt[], place: (d: THREE.Object3D, i: number) => number | void) {
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length), c = new THREE.Color();
  pts.forEach(([x, z], i) => {
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    const color = place(dummy, i);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (color !== undefined) mesh.setColorAt(i, c.setHex(color));
  });
  return mesh;
}

const shade = (hex: number, r: () => number, amount = 0.08) => new THREE.Color(hex).offsetHSL(0, 0, (r() - 0.5) * amount).getHex();
const pick = (list: number[], r: () => number) => list[Math.floor(r() * list.length)];

function trees(pts: Pt[], r: () => number, greens: number[], palm = false) {
  const g = new THREE.Group();
  const sizes = pts.map(() => ({ h: palm ? 8 + r() * 5 : 6 + r() * 9, w: 0.8 + r() * 0.4, yaw: r() * 6.3 }));
  g.add(instances(new THREE.CylinderGeometry(0.18, 0.3, 1, 6).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: palm ? 0x8a7350 : 0x5b4632 }), pts, (d, i) => {
      const { h } = sizes[i];
      d.scale.set(h / 10, palm ? h : h * 0.55, h / 10);
      if (palm) d.rotation.z = (r() - 0.5) * 0.25; // palms lean
    }));
  g.add(instances(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ flatShading: true }), pts, (d, i) => {
    const { h, w, yaw } = sizes[i];
    d.position.y = palm ? h : h * 0.62;
    d.rotation.y = yaw;
    if (palm) d.scale.set(2.8 * w, 0.7, 2.8 * w);
    else d.scale.set(h * 0.3 * w, h * 0.38, h * 0.3 * (0.8 + r() * 0.4));
    return shade(pick(greens, r), r);
  }));
  g.add(instances(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }), pts, (d, i) => {
      const s = palm ? 2.5 : sizes[i].h * 0.33 * sizes[i].w;
      d.position.y = 0.07;
      d.scale.set(s, 1, s);
    }));
  return g;
}

function houses(pts: Pt[], r: () => number) {
  const walls = [0xe8e0d0, 0xd9c7a8, 0xb5b0a8, 0xf0ece4, 0xa86b4f], roofs = [0x5a4a42, 0x8c3b2e, 0x4a5560, 0x6b6b6b];
  const sizes = pts.map(([x, z]) => ({ w: 8 + r() * 6, d: 8 + r() * 6, h: r() < 0.3 ? 6 : 3.2, yaw: Math.atan2(x, z) + (r() - 0.5) * 0.4 }));
  const g = new THREE.Group();
  g.add(instances(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), pts, (o, i) => {
    const { w, d, h, yaw } = sizes[i];
    o.rotation.y = yaw;
    o.scale.set(w, h, d);
    return shade(pick(walls, r), r, 0.05);
  }));
  // A 4-sided cone turned 45° is a square hip roof.
  g.add(instances(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ flatShading: true }), pts, (o, i) => {
      const { w, d, h, yaw } = sizes[i];
      o.position.y = h;
      o.rotation.y = yaw;
      o.scale.set(w * 1.1, 2 + r() * 1.5, d * 1.1);
      return pick(roofs, r);
    }));
  return g;
}

function hills(r: () => number, a0: number, a1: number, color: number) {
  // Half-buried flattened domes read as rolling hills; fog fades them into the haze.
  return instances(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshLambertMaterial({ flatShading: true }),
    ring(26, 520, 760, r, a0, a1), (d) => {
      const rad = 160 + r() * 200;
      d.scale.set(rad, 25 + r() * 45, rad * (0.6 + r() * 0.6));
      d.rotation.y = r() * 6.3;
      return shade(color, r, 0.1);
    });
}

function fence(corners: Pt[]) {
  const g = new THREE.Group(), wood = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
  const posts = corners.flatMap((p, i) => line(p, corners[(i + 1) % corners.length], 3, () => 0));
  g.add(instances(new THREE.BoxGeometry(0.12, 1.2, 0.12).translate(0, 0.6, 0), wood, posts, () => undefined));
  corners.forEach(([x0, z0], i) => {
    const [x1, z1] = corners[(i + 1) % corners.length];
    for (const y of [0.55, 1.05]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, Math.hypot(x1 - x0, z1 - z0)), wood);
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.rotation.y = Math.atan2(x1 - x0, z1 - z0);
      g.add(rail);
    }
  });
  return g;
}

// Round hay bales, 1.5 m across: objects of a known size help you judge distance.
function bales(pts: Pt[], r: () => number) {
  return instances(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 16).rotateZ(Math.PI / 2).translate(0, 0.75, 0),
    new THREE.MeshLambertMaterial(), pts, (d) => { d.rotation.y = r() * 6.3; return shade(0xc8a95b, r); });
}

// A full-size soccer goal (7.32 × 2.44 m) at distance z.
function goal(z: number) {
  const g = new THREE.Group(), white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (const x of [-3.66, 3.66]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), white);
    post.position.set(x, 1.22, 0);
    g.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.44, 8).rotateZ(Math.PI / 2), white);
  bar.position.y = 2.44;
  g.add(bar);
  g.position.z = z;
  return g;
}

// --- drone

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
  shadow.position.set(s.pos.x, 0.08, s.pos.z);
  (shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.max(0.15, 1 - s.pos.y / 40);
}
