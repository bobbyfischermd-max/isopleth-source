import { geoEquirectangular, geoGraticule, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";

export const MAP_W = 960;
export const MAP_H = 480;

const OCEAN: [number, number, number] = [11, 20, 26];

type WorldTopo = Topology<{ land: GeometryCollection; countries: GeometryCollection }>;

export interface LandIndex {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  pix: Uint32Array;
  i0: Uint16Array;
  i1: Uint16Array;
  i2: Uint16Array;
  w0: Float32Array;
  w1: Float32Array;
  w2: Float32Array;
  border: Uint8ClampedArray;
}

function ramp(t: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0, 18, 32, 30],
    [0.32, 30, 62, 50],
    [0.58, 64, 104, 74],
    [0.78, 198, 161, 90],
    [1, 236, 226, 204],
  ];
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && x > (stops[i + 1]?.[0] ?? 1)) i++;
  const a = stops[i] ?? stops[0]!;
  const b = stops[i + 1] ?? a;
  const span = b[0] - a[0] || 1;
  const u = (x - a[0]) / span;
  return [
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
    Math.round(a[3] + (b[3] - a[3]) * u),
  ];
}

export async function buildLandIndex(points: { lat: number; lon: number }[]): Promise<LandIndex> {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable.");

  const topology = world as unknown as WorldTopo;
  const land = feature(topology, topology.objects.land);
  const countries = feature(topology, topology.objects.countries);
  const projection = geoEquirectangular().fitExtent(
    [
      [0, 0],
      [MAP_W, MAP_H],
    ],
    { type: "Sphere" },
  );
  const path = geoPath(projection, ctx);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  ctx.beginPath();
  path(land);
  ctx.fillStyle = "#fff";
  ctx.fill();
  const mask = ctx.getImageData(0, 0, MAP_W, MAP_H).data;

  ctx.clearRect(0, 0, MAP_W, MAP_H);
  ctx.beginPath();
  path(geoGraticule().step([30, 30])());
  ctx.strokeStyle = "rgba(235, 230, 216, 0.28)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.beginPath();
  path(countries);
  ctx.strokeStyle = "rgba(235, 230, 216, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  const border = ctx.getImageData(0, 0, MAP_W, MAP_H).data;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const candidates: number[] = [];
  for (let p = 0; p < MAP_W * MAP_H; p++) {
    if ((mask[p * 4] ?? 0) > 200) candidates.push(p);
  }
  const n = candidates.length;
  const pix = new Uint32Array(n);
  const i0 = new Uint16Array(n);
  const i1 = new Uint16Array(n);
  const i2 = new Uint16Array(n);
  const w0 = new Float32Array(n);
  const w1 = new Float32Array(n);
  const w2 = new Float32Array(n);

  const cosLat = lats.map((lat) => Math.cos((lat * Math.PI) / 180));
  for (let k = 0; k < n; k++) {
    if (k % 25000 === 0) await new Promise((r) => setTimeout(r, 0));
    const p = candidates[k] ?? 0;
    pix[k] = p;
    const x = p % MAP_W;
    const y = (p / MAP_W) | 0;
    const ll = projection.invert?.([x + 0.5, y + 0.5]);
    if (!ll || points.length === 0) continue;
    const lon = ll[0];
    const lat = ll[1];
    const cos = Math.cos((lat * Math.PI) / 180);
    let b0 = 0;
    let b1 = 1;
    let b2 = 2;
    let d0 = Infinity;
    let d1 = Infinity;
    let d2 = Infinity;
    for (let j = 0; j < points.length; j++) {
      const dx = (lon - (lons[j] ?? 0)) * cos;
      const dy = lat - (lats[j] ?? 0);
      const d = dx * dx + dy * dy;
      if (d < d0) {
        d2 = d1;
        b2 = b1;
        d1 = d0;
        b1 = b0;
        d0 = d;
        b0 = j;
      } else if (d < d1) {
        d2 = d1;
        b2 = b1;
        d1 = d;
        b1 = j;
      } else if (d < d2) {
        d2 = d;
        b2 = j;
      }
    }
    const km = (d: number) => Math.max(90, Math.sqrt(d) * 111);
    const a0 = 1 / (km(d0) * km(d0));
    const a1 = points.length > 1 ? 1 / (km(d1) * km(d1)) : 0;
    const a2 = points.length > 2 ? 1 / (km(d2) * km(d2)) : 0;
    const sum = a0 + a1 + a2 || 1;
    i0[k] = b0;
    i1[k] = Math.min(b1, points.length - 1);
    i2[k] = Math.min(b2, points.length - 1);
    w0[k] = a0 / sum;
    w1[k] = a1 / sum;
    w2[k] = a2 / sum;
  }

  ctx.fillStyle = `rgb(${OCEAN[0]}, ${OCEAN[1]}, ${OCEAN[2]})`;
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  return { canvas, ctx, pix, i0, i1, i2, w0, w1, w2, border };
}

export function paintTexture(index: LandIndex, values: ArrayLike<number>): void {
  const img = index.ctx.createImageData(MAP_W, MAP_H);
  const d = img.data;
  for (let p = 0; p < MAP_W * MAP_H; p++) {
    const o = p * 4;
    d[o] = OCEAN[0];
    d[o + 1] = OCEAN[1];
    d[o + 2] = OCEAN[2];
    d[o + 3] = 255;
  }
  const n = index.pix.length;
  for (let k = 0; k < n; k++) {
    const p = index.pix[k] ?? 0;
    const v =
      (values[index.i0[k] ?? 0] ?? 0) * (index.w0[k] ?? 0) +
      (values[index.i1[k] ?? 0] ?? 0) * (index.w1[k] ?? 0) +
      (values[index.i2[k] ?? 0] ?? 0) * (index.w2[k] ?? 0);
    const [r, g, b] = ramp(v);
    const o = p * 4;
    d[o] = r;
    d[o + 1] = g;
    d[o + 2] = b;
    d[o + 3] = 255;
  }
  const border = index.border;
  for (let p = 0; p < MAP_W * MAP_H; p++) {
    const a = border[p * 4 + 3] ?? 0;
    if (a < 8) continue;
    const o = p * 4;
    const t = a / 255;
    d[o] = Math.round((d[o] ?? 0) * (1 - t) + (border[o] ?? 0) * t);
    d[o + 1] = Math.round((d[o + 1] ?? 0) * (1 - t) + (border[o + 1] ?? 0) * t);
    d[o + 2] = Math.round((d[o + 2] ?? 0) * (1 - t) + (border[o + 2] ?? 0) * t);
  }
  index.ctx.putImageData(img, 0, 0);
}
