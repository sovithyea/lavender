export type StickMode = 1 | 2 | 3 | 4;

// Raw thumb positions, -1..1, up and right positive.
export interface RawSticks { lx: number; ly: number; rx: number; ry: number }

// Flight commands, -1..1: throttle up, yaw right, pitch forward, roll right are positive.
export interface Sticks { throttle: number; yaw: number; pitch: number; roll: number }

export const NEUTRAL: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

export function mapSticks(mode: StickMode, r: RawSticks): Sticks {
  switch (mode) {
    case 1: return { pitch: r.ly, yaw: r.lx, throttle: r.ry, roll: r.rx };
    case 2: return { throttle: r.ly, yaw: r.lx, pitch: r.ry, roll: r.rx };
    case 3: return { pitch: r.ly, roll: r.lx, throttle: r.ry, yaw: r.rx };
    case 4: return { throttle: r.ly, roll: r.lx, pitch: r.ry, yaw: r.rx };
  }
}

const clean = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

// Sticks arrive over the network, so never trust their shape or range.
export function sanitizeSticks(s: unknown): Sticks {
  const o = (s ?? {}) as Record<string, unknown>;
  return { throttle: clean(o.throttle), yaw: clean(o.yaw), pitch: clean(o.pitch), roll: clean(o.roll) };
}
