import type { FlightParams } from './config.ts';
import type { Sticks } from './sticks.ts';

// World frame (three.js): x = pilot's right, y = up, -z = away from the pilot.
// Yaw/heading: 0 = nose pointing away from the pilot, positive = clockwise seen from above.
export interface Vec3 { x: number; y: number; z: number }

export interface DroneState {
  pos: Vec3;
  vel: Vec3;
  roll: number;   // rad, positive = right side down
  pitch: number;  // rad, positive = nose down
  yaw: number;    // rad, see above
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  thrust: number;                 // collective specific force, m/s²
  hold: { x: number; z: number } | null; // captured position-hold point
  holdAlt: number | null;
  velInt: { x: number; z: number };      // velocity-loop integrator (soaks up wind)
}

export const G = 9.81;
export const DEG = Math.PI / 180;
const DEADBAND = 0.05;

// Autopilot gains: these shape the flight controller, not the airframe, so they stay here.
const K_VEL = 2.5, K_VEL_I = 0.6, VEL_INT_MAX = 3, K_POS = 1.2, K_ALT = 1.5, K_VZ = 3, K_ATT = 8;
const CAPTURE_SPEED = 0.3; // m/s: brake first, capture the hold point once this slow
const YAW_LAG_FACTOR = 3;  // yaw authority comes from rotor drag torque, so it spools slower than tilt

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lag = (cur: number, target: number, tau: number, dt: number) => cur + (target - cur) * (dt / (tau + dt));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function forwardOf(yaw: number) { return { x: Math.sin(yaw), z: -Math.cos(yaw) }; }
export function rightOf(yaw: number) { return { x: Math.cos(yaw), z: Math.sin(yaw) }; }

export function expo(v: number, e: number): number {
  const a = Math.abs(v);
  if (a < DEADBAND) return 0;
  const x = Math.min(1, (a - DEADBAND) / (1 - DEADBAND));
  return Math.sign(v) * ((1 - e) * x + e * x ** 3);
}

export function createState(pos: Vec3, yaw: number): DroneState {
  return {
    pos: { ...pos }, vel: { x: 0, y: 0, z: 0 },
    roll: 0, pitch: 0, yaw, rollRate: 0, pitchRate: 0, yawRate: 0,
    thrust: G, hold: null, holdAlt: null, velInt: { x: 0, z: 0 },
  };
}

// Advances the drone by dt seconds. Mutates and returns s.
export function step(s: DroneState, input: Sticks, p: FlightParams, wind: Vec3, dt: number): DroneState {
  const th = expo(input.throttle, p.expo), yw = expo(input.yaw, p.expo);
  const pi = expo(input.pitch, p.expo), ro = expo(input.roll, p.expo);
  const fwd = forwardOf(s.yaw), right = rightOf(s.yaw);
  const tMax = p.maxTiltDeg * DEG;

  // Vertical: throttle commands climb rate; centred brakes, then holds the captured altitude.
  let vzDes: number;
  if (th !== 0) {
    s.holdAlt = null;
    vzDes = th > 0 ? th * p.maxClimb : th * p.maxDescent;
  } else {
    if (s.holdAlt === null && Math.abs(s.vel.y) < CAPTURE_SPEED) s.holdAlt = s.pos.y;
    vzDes = s.holdAlt === null ? 0 : clamp(K_ALT * (s.holdAlt - s.pos.y), -p.maxDescent, p.maxClimb);
  }
  const azDes = clamp(K_VZ * (vzDes - s.vel.y) + p.drag * Math.abs(s.vel.y) * s.vel.y, -p.maxVertAccel, p.maxVertAccel);

  // Horizontal: work out the tilt to command.
  let pitchCmd: number, rollCmd: number;
  if (p.mode === 'attitude') {
    pitchCmd = pi * tMax;
    rollCmd = ro * tMax;
  } else {
    let vdx: number, vdz: number;
    if (pi !== 0 || ro !== 0) {
      s.hold = null;
      vdx = (fwd.x * pi + right.x * ro) * p.maxSpeed;
      vdz = (fwd.z * pi + right.z * ro) * p.maxSpeed;
    } else {
      if (!s.hold && Math.hypot(s.vel.x, s.vel.z) < CAPTURE_SPEED) s.hold = { x: s.pos.x, z: s.pos.z };
      vdx = s.hold ? K_POS * (s.hold.x - s.pos.x) : 0;
      vdz = s.hold ? K_POS * (s.hold.z - s.pos.z) : 0;
    }
    const vdMag = Math.hypot(vdx, vdz);
    if (vdMag > p.maxSpeed) { vdx *= p.maxSpeed / vdMag; vdz *= p.maxSpeed / vdMag; }

    const ex = vdx - s.vel.x, ez = vdz - s.vel.z;
    // Feed-forward the drag the drone knows about (from its own ground speed); the integrator handles wind.
    const gs = Math.hypot(s.vel.x, s.vel.z);
    let ax = K_VEL * ex + s.velInt.x + p.drag * gs * s.vel.x;
    let az = K_VEL * ez + s.velInt.z + p.drag * gs * s.vel.z;
    const aMag = Math.hypot(ax, az);
    if (aMag > p.maxAccel) { ax *= p.maxAccel / aMag; az *= p.maxAccel / aMag; }
    else { // only integrate when not saturated, or the integrator winds up and overshoots
      s.velInt.x = clamp(s.velInt.x + K_VEL_I * ex * dt, -VEL_INT_MAX, VEL_INT_MAX);
      s.velInt.z = clamp(s.velInt.z + K_VEL_I * ez * dt, -VEL_INT_MAX, VEL_INT_MAX);
    }

    pitchCmd = clamp(Math.atan((ax * fwd.x + az * fwd.z) / G), -tMax, tMax);
    rollCmd = clamp(Math.atan((ax * right.x + az * right.z) / G), -tMax, tMax);
  }

  // Attitude dynamics: angle loop -> rate (limited) -> rate follows with motor lag.
  const rateMax = p.maxTiltRateDeg * DEG;
  s.rollRate = lag(s.rollRate, clamp(K_ATT * (rollCmd - s.roll), -rateMax, rateMax), p.motorLag, dt);
  s.pitchRate = lag(s.pitchRate, clamp(K_ATT * (pitchCmd - s.pitch), -rateMax, rateMax), p.motorLag, dt);
  s.yawRate = lag(s.yawRate, yw * p.maxYawRateDeg * DEG, p.motorLag * YAW_LAG_FACTOR, dt);
  s.roll += s.rollRate * dt;
  s.pitch += s.pitchRate * dt;
  s.yaw = wrapAngle(s.yaw + s.yawRate * dt);

  // Collective thrust, tilt-compensated, with motor lag.
  const level = Math.cos(s.roll) * Math.cos(s.pitch);
  s.thrust = lag(s.thrust, clamp((G + azDes) / level, 0, p.maxThrustG * G), p.motorLag, dt);

  // Translational rigid body: thrust along body-up, gravity, quadratic drag on airspeed.
  const f2 = forwardOf(s.yaw), r2 = rightOf(s.yaw);
  const uR = Math.sin(s.roll) * Math.cos(s.pitch), uF = Math.sin(s.pitch);
  const air = { x: s.vel.x - wind.x, y: s.vel.y - wind.y, z: s.vel.z - wind.z };
  const airSpeed = Math.hypot(air.x, air.y, air.z);
  s.vel.x += (s.thrust * (uR * r2.x + uF * f2.x) - p.drag * airSpeed * air.x) * dt;
  s.vel.y += (s.thrust * level - G - p.drag * airSpeed * air.y) * dt;
  s.vel.z += (s.thrust * (uR * r2.z + uF * f2.z) - p.drag * airSpeed * air.z) * dt;
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  s.pos.z += s.vel.z * dt;

  // Ground contact: sit level, no sliding or spinning on the grass.
  if (s.pos.y <= 0 && s.vel.y <= 0) {
    s.pos.y = 0;
    s.vel = { x: 0, y: 0, z: 0 };
    s.roll = s.pitch = s.rollRate = s.pitchRate = s.yawRate = 0;
    s.velInt = { x: 0, z: 0 };
    s.hold = { x: s.pos.x, z: s.pos.z };
  }
  return s;
}
