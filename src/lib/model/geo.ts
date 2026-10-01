const R = 6371;

export function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 1 at or below `low`, 0 at or above `high`. */
export function falloff(low: number, high: number, x: number): number {
  return 1 - smoothstep(low, high, x);
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function toVec(lat: number, lon: number): [number, number, number] {
  const p = (lat * Math.PI) / 180;
  const t = (lon * Math.PI) / 180;
  return [Math.cos(p) * Math.sin(t), Math.sin(p), Math.cos(p) * Math.cos(t)];
}

export function fromVec(x: number, y: number, z: number): { lat: number; lon: number } {
  const len = Math.hypot(x, y, z) || 1;
  const lat = (Math.asin(Math.max(-1, Math.min(1, y / len))) * 180) / Math.PI;
  const lon = (Math.atan2(x / len, z / len) * 180) / Math.PI;
  return { lat, lon };
}

/** Degrees clockwise from north, toward the second point. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * p) * Math.cos(lat2 * p);
  const x =
    Math.cos(lat1 * p) * Math.sin(lat2 * p) -
    Math.sin(lat1 * p) * Math.cos(lat2 * p) * Math.cos((lon2 - lon1) * p);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function compass(bearing: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const b = ((bearing % 360) + 360) % 360;
  return dirs[Math.round(b / 45) % 8] ?? "N";
}

export function centroid(points: { lat: number; lon: number; w: number }[]): {
  lat: number;
  lon: number;
} {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const v = toVec(p.lat, p.lon);
    x += v[0] * p.w;
    y += v[1] * p.w;
    z += v[2] * p.w;
  }
  return fromVec(x, y, z);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
