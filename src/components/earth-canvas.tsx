import { useEffect, useRef, useState } from "react";
import { MAP_H, MAP_W, buildLandIndex, paintTexture, type LandIndex } from "@/lib/map/land";
import type { Arrow, Zone } from "@/lib/model/engine";
import { NODES } from "@/lib/model/nodes";
import type { ProjectionMode } from "@/lib/model/store";

interface Props {
  lens: number[];
  signature: string;
  zones: Zone[];
  arrows: Arrow[];
  selectedId: string | null;
  projection: ProjectionMode;
  onPick: (id: string) => void;
}

interface View {
  yaw: number;
  pitch: number;
  zoom: number;
  vx: number;
  vy: number;
  dragging: boolean;
}

interface Projected {
  x: number;
  y: number;
  front: boolean;
}

export function EarthCanvas({ lens, signature, zones, arrows, selectedId, projection, onPick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const indexRef = useRef<LandIndex | null>(null);
  const pixelsRef = useRef<Uint8ClampedArray | null>(null);
  const viewRef = useRef<View>({ yaw: -28, pitch: 14, zoom: 1, vx: 0, vy: 0, dragging: false });
  const lensRef = useRef(lens);
  const propsRef = useRef({ zones, arrows, selectedId, projection, onPick });
  const projectRef = useRef<(lat: number, lon: number) => Projected | null>(() => null);
  const dirty = useRef(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  lensRef.current = lens;
  propsRef.current = { zones, arrows, selectedId, projection, onPick };

  useEffect(() => {
    let cancel = false;
    buildLandIndex(NODES.map((n) => ({ lat: n.lat, lon: n.lon })))
      .then((idx) => {
        if (cancel) return;
        indexRef.current = idx;
        paintTexture(idx, lensRef.current);
        pixelsRef.current = idx.ctx.getImageData(0, 0, MAP_W, MAP_H).data;
        setReady(true);
        dirty.current = true;
      })
      .catch((err: unknown) => {
        if (!cancel) setFailed(err instanceof Error ? err.message : "Map failed");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const idx = indexRef.current;
    if (!idx || !ready) return;
    paintTexture(idx, lensRef.current);
    pixelsRef.current = idx.ctx.getImageData(0, 0, MAP_W, MAP_H).data;
    dirty.current = true;
  }, [signature, ready]);

  useEffect(() => {
    dirty.current = true;
  }, [zones, arrows, selectedId, projection, ready]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const globe = globeRef.current;
    const over = overRef.current;
    if (!wrap || !globe || !over) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const drag = {
      id: -1,
      x: 0,
      y: 0,
      lx: 0,
      ly: 0,
      moved: false,
      active: false,
    };

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const cssW = Math.max(1, rect.width);
      const cssH = Math.max(1, rect.height);
      const mode = propsRef.current.projection;
      const dpr = Math.min(window.devicePixelRatio || 1, mode === "globe" ? 1.35 : 2);
      const bufW = Math.round(cssW * dpr);
      const bufH = Math.round(cssH * dpr);
      for (const c of [globe, over]) {
        if (c.width !== bufW || c.height !== bufH) {
          c.width = bufW;
          c.height = bufH;
        }
      }
      const g = globe.getContext("2d");
      const o = over.getContext("2d");
      if (!g || !o) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      o.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, bufW, bufH);
      o.clearRect(0, 0, bufW, bufH);

      const view = viewRef.current;
      const tex = indexRef.current?.canvas ?? null;
      const pixels = pixelsRef.current;

      let project: (lat: number, lon: number) => Projected | null = () => null;

      if (mode === "plate" && tex) {
        const aspect = MAP_W / MAP_H;
        let dw = bufW;
        let dh = dw / aspect;
        if (dh > bufH) {
          dh = bufH;
          dw = dh * aspect;
        }
        const ox = (bufW - dw) / 2;
        const oy = (bufH - dh) / 2;
        g.drawImage(tex, ox, oy, dw, dh);
        project = (lat, lon) => ({
          x: ox + ((lon + 180) / 360) * dw,
          y: oy + ((90 - lat) / 180) * dh,
          front: true,
        });
      } else if (mode === "globe" && pixels) {
        const cx = bufW / 2;
        const cy = bufH / 2;
        const R = Math.min(bufW, bufH) * 0.46 * view.zoom;
        const yaw = (view.yaw * Math.PI) / 180;
        const pitch = (view.pitch * Math.PI) / 180;
        const cyaw = Math.cos(yaw);
        const syaw = Math.sin(yaw);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const img = g.createImageData(bufW, bufH);
        const out = img.data;
        const step = view.dragging ? 2 : 1;
        for (let y = 0; y < bufH; y += step) {
          const dy = (cy - y) / R;
          for (let x = 0; x < bufW; x += step) {
            const dx = (x - cx) / R;
            const r2 = dx * dx + dy * dy;
            if (r2 > 1) {
              if (r2 < 1.055) {
                const edge = 1 - (Math.sqrt(r2) - 1) / 0.055;
                const a = Math.max(0, edge) * 70;
                for (let yy = 0; yy < step && y + yy < bufH; yy++) {
                  for (let xx = 0; xx < step && x + xx < bufW; xx++) {
                    const o4 = ((y + yy) * bufW + (x + xx)) * 4;
                    out[o4] = 198;
                    out[o4 + 1] = 161;
                    out[o4 + 2] = 90;
                    out[o4 + 3] = a;
                  }
                }
              }
              continue;
            }
            const z = Math.sqrt(1 - r2);
            const y1 = dy * cp + z * sp;
            const z1 = -dy * sp + z * cp;
            const xe = dx * cyaw + z1 * syaw;
            const ze = -dx * syaw + z1 * cyaw;
            const lat = Math.asin(Math.max(-1, Math.min(1, y1)));
            const lon = Math.atan2(xe, ze);
            let u = ((lon + Math.PI) / (2 * Math.PI)) * MAP_W;
            let v = (0.5 - lat / Math.PI) * MAP_H;
            u = ((u % MAP_W) + MAP_W) % MAP_W;
            v = Math.max(0, Math.min(MAP_H - 1, v));
            const tx = u | 0;
            const ty = v | 0;
            const p = (ty * MAP_W + tx) * 4;
            const light = Math.max(0.2, 0.16 + z * 0.9);
            for (let yy = 0; yy < step && y + yy < bufH; yy++) {
              for (let xx = 0; xx < step && x + xx < bufW; xx++) {
                const o4 = ((y + yy) * bufW + (x + xx)) * 4;
                out[o4] = (pixels[p] ?? 0) * light;
                out[o4 + 1] = (pixels[p + 1] ?? 0) * light;
                out[o4 + 2] = (pixels[p + 2] ?? 0) * light;
                out[o4 + 3] = 255;
              }
            }
          }
        }
        g.putImageData(img, 0, 0);
        project = makeGlobeProject(cx, cy, R, yaw, pitch);
      } else {
        g.fillStyle = "#0b141a";
        g.fillRect(0, 0, bufW, bufH);
      }

      projectRef.current = project;
      drawOverlay(o, project, propsRef.current.zones, propsRef.current.arrows, propsRef.current.selectedId, mode, bufH);
    };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = viewRef.current;
      if (!reduced && (v.vx || v.vy)) {
        v.yaw += v.vx;
        v.pitch = Math.max(-62, Math.min(62, v.pitch + v.vy));
        v.vx *= 0.9;
        v.vy *= 0.9;
        if (Math.abs(v.vx) < 0.02) v.vx = 0;
        if (Math.abs(v.vy) < 0.02) v.vy = 0;
        dirty.current = true;
      }
      if (!dirty.current) return;
      dirty.current = Boolean(v.vx || v.vy);
      draw();
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      dirty.current = true;
    });
    ro.observe(wrap);

    const down = (e: PointerEvent) => {
      wrap.setPointerCapture(e.pointerId);
      drag.active = true;
      drag.id = e.pointerId;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.lx = 0;
      drag.ly = 0;
      drag.moved = false;
      viewRef.current.dragging = true;
      viewRef.current.vx = 0;
      viewRef.current.vy = 0;
    };
    const move = (e: PointerEvent) => {
      if (!drag.active || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(e.clientX - drag.x + drag.lx, e.clientY - drag.y + drag.ly) > 5) drag.moved = true;
      if (propsRef.current.projection === "globe") {
        viewRef.current.yaw -= dx * 0.32;
        viewRef.current.pitch = Math.max(-62, Math.min(62, viewRef.current.pitch + dy * 0.28));
        drag.lx = dx;
        drag.ly = dy;
        dirty.current = true;
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (!drag.active || drag.id !== e.pointerId) return;
      drag.active = false;
      viewRef.current.dragging = false;
      if (!drag.moved) {
        const rect = wrap.getBoundingClientRect();
        const dpr = globe.width / Math.max(1, rect.width);
        const x = (e.clientX - rect.left) * dpr;
        const y = (e.clientY - rect.top) * dpr;
        const id = pick(x, y, projectRef.current, propsRef.current.zones);
        if (id) propsRef.current.onPick(id);
      } else if (!reduced && propsRef.current.projection === "globe") {
        viewRef.current.vx = -drag.lx * 0.32;
        viewRef.current.vy = drag.ly * 0.28;
      }
      dirty.current = true;
    };
    const wheel = (e: WheelEvent) => {
      if (propsRef.current.projection !== "globe") return;
      e.preventDefault();
      const z = viewRef.current.zoom * (e.deltaY > 0 ? 0.94 : 1.06);
      viewRef.current.zoom = Math.max(0.85, Math.min(1.7, z));
      dirty.current = true;
    };

    wrap.addEventListener("pointerdown", down);
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", up);
    wrap.addEventListener("wheel", wheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener("pointerdown", down);
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", up);
      wrap.removeEventListener("pointercancel", up);
      wrap.removeEventListener("wheel", wheel);
    };
  }, [ready]);

  return (
    <div
      ref={wrapRef}
      className={`stage-canvas ${projection === "globe" ? "is-globe" : "is-plate"}`}
    >
      <canvas ref={globeRef} className="earth-layer" />
      <canvas ref={overRef} className="earth-layer earth-overlay" />
      {!ready && !failed && (
        <p className="stage-status font-mono text-xs text-muted">Drawing coastlines…</p>
      )}
      {failed && <p className="stage-status font-mono text-xs text-brass">{failed}</p>}
    </div>
  );
}

function makeGlobeProject(cx: number, cy: number, R: number, yaw: number, pitch: number) {
  const cyaw = Math.cos(yaw);
  const syaw = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return (lat: number, lon: number): Projected => {
    const φ = (lat * Math.PI) / 180;
    const λ = (lon * Math.PI) / 180;
    let x = Math.cos(φ) * Math.sin(λ);
    let y = Math.sin(φ);
    let z = Math.cos(φ) * Math.cos(λ);
    // Inverse of the sampler's inverse rotation: apply yaw then pitch.
    const x1 = x * cyaw - z * syaw;
    const z1 = x * syaw + z * cyaw;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    x = x1;
    y = y2;
    z = z2;
    return { x: cx + x * R, y: cy - y * R, front: z > 0.02 };
  };
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  project: (lat: number, lon: number) => Projected | null,
  zones: Zone[],
  arrows: Arrow[],
  selectedId: string | null,
  mode: ProjectionMode,
  bufH: number,
) {
  ctx.lineWidth = Math.max(1, bufH / 420);
  ctx.font = `${Math.max(11, bufH / 48)}px "IBM Plex Mono", ui-monospace, sans-serif`;
  const labeled: { x: number; y: number }[] = [];

  for (const arrow of arrows) {
    const p = project(arrow.lat, arrow.lon);
    if (!p || !p.front) continue;
    const len = 10 + arrow.mag * 18;
    const rad = (arrow.bearing * Math.PI) / 180;
    const dx = Math.sin(rad) * len;
    const dy = -Math.cos(rad) * len;
    ctx.strokeStyle = "rgba(235, 230, 216, 0.55)";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + dx, p.y + dy);
    ctx.stroke();
  }

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (!zone) continue;
    const p = project(zone.centroid.lat, zone.centroid.lon);
    if (!p || !p.front) continue;
    const radiusPx =
      mode === "plate"
        ? Math.max(8, (zone.radiusKm / 6371) * (bufH / Math.PI) * 1.15)
        : Math.max(8, (zone.radiusKm / 6371) * (bufH * 0.46) * 1.35);
    const selected = zone.nodeIds.includes(selectedId ?? "");
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.min(radiusPx, bufH * 0.18), 0, Math.PI * 2);
    ctx.strokeStyle = selected ? "rgba(236, 226, 204, 0.95)" : zone.marginal ? "rgba(143, 151, 142, 0.7)" : "rgba(198, 161, 90, 0.9)";
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.setLineDash(zone.marginal ? [4, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    if (i < 4 || selected) {
      const tooClose = labeled.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 72);
      if (!tooClose) {
        labeled.push(p);
        ctx.fillStyle = "rgba(12, 18, 16, 0.72)";
        const raw = (zone.name.split(" · ")[0] ?? zone.name).replace(" corridor", "").replace(" basin", "");
        const text = raw.length > 24 ? `${raw.slice(0, 22)}…` : raw;
        const w = ctx.measureText(text).width + 8;
        ctx.fillRect(p.x + 8, p.y - 16, w, 16);
        ctx.fillStyle = selected ? "#f3ead2" : "#e4d0a1";
        ctx.fillText(text, p.x + 12, p.y - 4);
      }
    }
  }

  if (selectedId) {
    const node = NODES.find((n) => n.id === selectedId);
    if (node) {
      const p = project(node.lat, node.lon);
      if (p?.front) {
        ctx.fillStyle = "#f3ead2";
        ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      }
    }
  }
}

function pick(
  x: number,
  y: number,
  project: (lat: number, lon: number) => Projected | null,
  zones: Zone[],
): string | null {
  let best: { id: string; d: number } | null = null;
  for (const node of NODES) {
    const p = project(node.lat, node.lon);
    if (!p?.front) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < 22 && (!best || d < best.d)) best = { id: node.id, d };
  }
  if (best) return best.id;
  for (const zone of zones) {
    const p = project(zone.centroid.lat, zone.centroid.lon);
    if (!p?.front) continue;
    if (Math.hypot(p.x - x, p.y - y) < 28) return zone.leadId;
  }
  return null;
}
