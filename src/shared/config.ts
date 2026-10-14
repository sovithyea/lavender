// Every tunable number for the trainer lives in this file.
// The presets are PLACEHOLDER feels to tune by hand. They are NOT measured from, and do not
// claim to match, any real aircraft.

export type FlightMode = 'stabilised' | 'attitude';

export interface FlightParams {
  mode: FlightMode;        // stabilised = sticks command velocity, centred = brake + hold; attitude = sticks command tilt, drifts
  maxSpeed: number;        // m/s, horizontal
  maxClimb: number;        // m/s
  maxDescent: number;      // m/s
  maxTiltDeg: number;      // deg
  maxTiltRateDeg: number;  // deg/s, how fast the airframe can change attitude
  maxYawRateDeg: number;   // deg/s
  maxAccel: number;        // m/s², horizontal acceleration/braking limit
  maxVertAccel: number;    // m/s²
  expo: number;            // 0 = linear sticks, 1 = full cubic
  motorLag: number;        // s, first-order motor/thrust time constant
  drag: number;            // 1/m, quadratic drag coefficient (drag accel = drag * airspeed²)
  maxThrustG: number;      // max collective thrust as a multiple of g
}

export const PRESETS = {
  agile: {
    label: 'Agile feel (Phantom-class placeholder)',
    params: {
      mode: 'stabilised', maxSpeed: 10, maxClimb: 5, maxDescent: 3, maxTiltDeg: 30, maxTiltRateDeg: 200,
      maxYawRateDeg: 100, maxAccel: 6, maxVertAccel: 4, expo: 0.3, motorLag: 0.05, drag: 0.05, maxThrustG: 2,
    },
  },
  heavy: {
    label: 'Heavy feel (Matrice-200-class placeholder)',
    params: {
      mode: 'stabilised', maxSpeed: 8, maxClimb: 4, maxDescent: 3, maxTiltDeg: 20, maxTiltRateDeg: 90,
      maxYawRateDeg: 60, maxAccel: 3, maxVertAccel: 2.5, expo: 0.3, motorLag: 0.12, drag: 0.03, maxThrustG: 1.6,
    },
  },
} satisfies Record<string, { label: string; params: FlightParams }>;

export const SIM = {
  physicsHz: 120,
  failsafeMs: 300,       // no stick packet for this long = sticks neutral + "controller lost"
  pilotEyeHeight: 1.7,   // m
  spawnDistance: 10,     // m in front of the pilot
};
