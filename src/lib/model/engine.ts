import { NODES } from "@/lib/model/nodes";
import {
  KNOB_LABELS,
  SCENARIO_BY_ID,
  type Scenario,
  type ScenarioId,
} from "@/lib/model/scenarios";
import {
  BASIN_LABEL,
  DRIVER_IDS,
  EPOCH,
  FIELD_BY_ID,
  HORIZON_OFFSETS,
  SPAN,
  type BasinId,
  type DriverId,
  type Drivers,
  type FieldId,
  type FlowId,
} from "@/lib/model/types";
import {
  bearingDeg,
  centroid,
  clamp01,
  compass,
  falloff,
  haversine,
  hashString,
  mulberry32,
  smoothstep,
} from "@/lib/model/geo";

const NEIGHBORS: number[][] = NODES.map((n, i) => {
  const out: number[] = [];
  for (let j = 0; j < NODES.length; j++) {
    if (i === j) continue;
    const m = NODES[j];
    if (!m) continue;
    if (haversine(n.lat, n.lon, m.lat, m.lon) <= 2200) out.push(j);
  }
  return out;
});

export interface UtilityPart {
  key: string;
  label: string;
  weight: number;
  value: number;
  contribution: number;
}

export interface NodeState {
  index: number;
  id: string;
  drivers: Drivers;
  utility: number;
  parts: UtilityPart[];
  water: number;
  column: string;
  hot: DriverId[];
  effective: number;
  falseRisk: boolean;
  redundant: string[];
}

export interface ZoneMovement {
  status: "new" | "stable" | "split" | "merged" | "reappeared";
  kmPerDecade: number;
  bearing: number;
}

export interface Zone {
  id: string;
  name: string;
  nodeIds: string[];
  leadId: string;
  centroid: { lat: number; lon: number };
  radiusKm: number;
  meanEffective: number;
  dominant: { id: DriverId; mean: number }[];
  opposing: { id: DriverId; mean: number }[];
  falseRisk: boolean;
  redundant: string[];
  marginal: boolean;
  column: string;
  movement: ZoneMovement | null;
}

export interface Arrow {
  id: string;
  lat: number;
  lon: number;
  bearing: number;
  mag: number;
}

export interface SnapshotInput {
  year: number;
  scenarioId: ScenarioId;
  gain: number;
  threshold: number;
  enabled: Record<FieldId, boolean>;
  discount: boolean;
  flow: FlowId;
  lens: FieldId | "convergence";
}

export interface Snapshot {
  year: number;
  t: number;
  scenario: Scenario;
  states: NodeState[];
  byId: Map<string, NodeState>;
  corr: number[][];
  redundantPairs: { a: DriverId; b: DriverId; r: number }[];
  zones: Zone[];
  lens: number[];
  arrows: Arrow[];
  basinRanks: { basin: BasinId; label: string; utility: number; delta: number; count: number }[];
  flowLines: string[];
  mexico: { id: string; name: string; utilityRank: number; convergenceRank: number; utility: number; effective: number }[];
  leader: string;
  chaos: { lambdaPerYear: number; ratio: number; reading: string };
}

function tropicalOf(lat: number): number {
  return falloff(16, 34, Math.abs(lat));
}

function highLatOf(lat: number): number {
  return smoothstep(46, 64, Math.abs(lat));
}

function rawDrivers(index: number, t: number, s: Scenario): { drivers: Drivers; water: number } {
  const node = NODES[index];
  if (!node) throw new Error("node");
  const tropical = tropicalOf(node.lat);
  const highLat = highLatOf(node.lat);
  const meteoSlope = node.slope.meteo;
  const meteoTrend =
    meteoSlope >= 0 ? meteoSlope * t : meteoSlope * t * (0.75 + 0.45 * s.climate);

  const water = clamp01(
    node.water -
      s.climate * t * (1 - node.water) * 0.22 * (0.45 + 0.55 * tropical) +
      s.techUnlock * t * node.coast * (1 - node.water) * 0.18 -
      s.climate * t * node.agri * tropical * 0.04,
  );

  const climateState = clamp01(
    node.base.meteo +
      meteoTrend -
      s.climate * t * tropical * (0.08 + 0.1 * (1 - node.water)) +
      s.climate * t * highLat * (0.04 + 0.08 * node.water) -
      s.climate * t * node.coast * tropical * 0.03,
  );
  const meteo = clamp01(0.62 * climateState + 0.38 * water);

  const depletionHit =
    s.depletion *
    t *
    node.extract *
    (0.18 + 0.85 * node.hydrocarb) *
    (1 - 0.4 * Math.min(1, s.substitution));
  const mineralWear = s.depletion * t * node.minerals * node.extract * 0.1;
  const unlock =
    s.techUnlock *
    t *
    (0.42 * node.solar + 0.22 * node.minerals * Math.min(1.15, s.substitution) + 0.06 * node.coast);
  const commodity = Math.max(node.hydrocarb, node.minerals * 0.85);
  const disruptPenalty = Math.max(0, s.substitution - 1) * t * commodity * node.extract * 0.2;
  const resources = clamp01(
    node.base.resources + node.slope.resources * t - depletionHit - mineralWear + unlock - disruptPenalty,
  );

  const trend = node.slope.human;
  const trendApplied =
    trend >= 0
      ? trend * t * (0.55 + 0.45 * s.humanDiffusion)
      : trend * t * (1.15 - 0.35 * Math.min(1.4, s.humanDiffusion));
  const human = clamp01(
    node.base.human +
      trendApplied +
      Math.max(0, s.humanDiffusion - 1) * t * node.skills * 0.22 -
      s.climate * t * tropical * (1 - node.base.infra) * 0.045 +
      0.03 * t * (node.base.institutions - 0.5),
  );

  const infra = clamp01(
    node.base.infra +
      node.slope.infra * t * (0.45 + 0.55 * s.infraBuild) +
      Math.max(0, s.infraBuild - 0.65) *
        t *
        (0.16 * node.coast + 0.12 * node.strategic + 0.08 * node.base.human) -
      s.climate * t * (1 - node.base.infra) * 0.06 +
      s.techUnlock * t * node.solar * 0.035,
  );

  const corporate = clamp01(
    node.base.corporate +
      node.slope.corporate * t * (0.5 + 0.5 * s.corporateReach) +
      Math.max(0, s.corporateReach - 0.6) * t * 0.08 * node.strategic +
      0.4 * Math.min(0, resources - node.base.resources) +
      0.1 * Math.max(0, resources - node.base.resources),
  );

  const institutions = clamp01(
    node.base.institutions +
      node.slope.institutions * t * 0.8 -
      s.institutionalDrift * t * (0.12 + 0.28 * (1 - node.base.institutions)) +
      0.035 * t * (node.skills - 0.4) * (1 - 0.45 * s.institutionalDrift),
  );

  return { drivers: { meteo, resources, human, infra, corporate, institutions }, water };
}

function blend(d: Drivers, mean: Drivers, gain: number): Drivers {
  const pull = (a: number, b: number, k: number) => clamp01(a + gain * k * (b - a));
  return {
    meteo: pull(d.meteo, mean.meteo, 0.45),
    resources: pull(d.resources, mean.resources, 0.15),
    human: pull(d.human, mean.human, 0.3),
    infra: pull(d.infra, mean.infra, 0.35),
    corporate: pull(d.corporate, mean.corporate, 0.2),
    institutions: pull(d.institutions, mean.institutions, 0.1),
  };
}

function columnOf(index: number): string {
  const n = NODES[index];
  if (!n) return "Surface column";
  if (n.hydrocarb > 0.65 || n.minerals > 0.65) return "Surface plus subsurface";
  if (n.coast > 0.85 && n.minerals < 0.3 && n.hydrocarb < 0.3) return "Surface and offshore access";
  if (n.water > 0.75 && n.pop < 0.25) return "Surface and freshwater column";
  return "Surface column";
}

function utilityOf(
  index: number,
  d: Drivers,
  water: number,
  s: Scenario,
): { utility: number; parts: UtilityPart[] } {
  const node = NODES[index];
  if (!node) throw new Error("node");
  const surface = clamp01(0.55 * d.meteo + 0.45 * node.agri * (0.35 + 0.65 * water));
  const option = clamp01(0.4 * node.minerals + 0.4 * node.solar + 0.2 * node.water);
  const optionHeld = option * (0.35 + 0.65 * d.corporate);
  const strategicTerm = node.strategic * (0.4 + 0.6 * d.infra);
  const w = {
    surface: 0.18 + 0.05 * s.climate,
    resources: 0.2 + 0.06 * Math.max(0, s.depletion - 0.9),
    human: 0.2 + 0.08 * Math.max(0, s.humanDiffusion - 1),
    infra: 0.16 + 0.08 * Math.max(0, s.infraBuild - 1),
    institutions: 0.12,
    strategic: 0.08,
    option: 0.06 + 0.05 * Math.max(0, s.techUnlock - 0.7),
  };
  if (s.substitution > 1.1) {
    w.resources = Math.max(0.08, w.resources - 0.04);
    w.human += 0.02;
    w.infra += 0.02;
  }
  const sum = w.surface + w.resources + w.human + w.infra + w.institutions + w.strategic + w.option;
  const parts: UtilityPart[] = [
    { key: "surface", label: "Surface and climate", weight: w.surface / sum, value: surface, contribution: 0 },
    { key: "resources", label: "Accessible resources", weight: w.resources / sum, value: d.resources, contribution: 0 },
    { key: "human", label: "Human capital", weight: w.human / sum, value: d.human, contribution: 0 },
    { key: "infra", label: "Infrastructure access", weight: w.infra / sum, value: d.infra, contribution: 0 },
    { key: "institutions", label: "Institutions", weight: w.institutions / sum, value: d.institutions, contribution: 0 },
    { key: "strategic", label: "Network position", weight: w.strategic / sum, value: strategicTerm, contribution: 0 },
    { key: "option", label: "Option value under current control", weight: w.option / sum, value: optionHeld, contribution: 0 },
  ];
  for (const p of parts) p.contribution = p.weight * p.value;
  const utility = clamp01(parts.reduce((a, p) => a + p.contribution, 0));
  return { utility, parts };
}

export function evaluate(t: number, scenario: Scenario, gain: number): Omit<
  NodeState,
  "hot" | "effective" | "falseRisk" | "redundant"
>[] {
  const raw = NODES.map((_, i) => rawDrivers(i, t, scenario));
  const mixed = raw.map((row, i) => {
    if (gain <= 0.001) return row.drivers;
    const ns = NEIGHBORS[i] ?? [];
    if (!ns.length) return row.drivers;
    const mean = emptyDrivers();
    for (const j of ns) {
      const other = raw[j];
      if (!other) continue;
      for (const k of DRIVER_IDS) mean[k] += other.drivers[k];
    }
    for (const k of DRIVER_IDS) mean[k] /= ns.length;
    return blend(row.drivers, mean, gain);
  });
  return mixed.map((drivers, index) => {
    const water = raw[index]?.water ?? 0;
    const { utility, parts } = utilityOf(index, drivers, water, scenario);
    const node = NODES[index];
    return {
      index,
      id: node?.id ?? String(index),
      drivers,
      utility,
      parts,
      water,
      column: columnOf(index),
    };
  });
}

function emptyDrivers(): Drivers {
  return { meteo: 0, resources: 0, human: 0, infra: 0, corporate: 0, institutions: 0 };
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i] ?? 0;
    sy += ys[i] ?? 0;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] ?? 0) - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx < 1e-8 || dy < 1e-8) return 0;
  return num / Math.sqrt(dx * dy);
}

function correlation(states: { drivers: Drivers }[]): number[][] {
  const cols = DRIVER_IDS.map((k) => states.map((s) => s.drivers[k]));
  return DRIVER_IDS.map((_, i) => DRIVER_IDS.map((__, j) => pearson(cols[i] ?? [], cols[j] ?? [])));
}

export function scoreNode(
  drivers: Drivers,
  enabled: Record<FieldId, boolean>,
  corr: number[][],
  threshold: number,
  discount: boolean,
): { hot: DriverId[]; effective: number; falseRisk: boolean; redundant: string[] } {
  const hot = DRIVER_IDS.filter((k) => enabled[k] && drivers[k] >= threshold).sort(
    (a, b) => drivers[b] - drivers[a],
  );
  let effective = 0;
  const redundant: string[] = [];
  let falseRisk = false;
  hot.forEach((k, i) => {
    let factor = 1;
    const ki = DRIVER_IDS.indexOf(k);
    for (let j = 0; j < i; j++) {
      const prev = hot[j];
      if (!prev) continue;
      const pj = DRIVER_IDS.indexOf(prev);
      const r = corr[ki]?.[pj] ?? 0;
      if (r > 0.72 && discount) {
        const pen = clamp01((r - 0.72) / 0.28) * 0.4;
        factor *= 1 - pen;
        falseRisk = true;
        const label = `${FIELD_BY_ID[prev].short}–${FIELD_BY_ID[k].short} r=${r.toFixed(2)}`;
        if (!redundant.includes(label)) redundant.push(label);
      } else if (r > 0.72) {
        falseRisk = true;
      }
    }
    effective += factor;
  });
  return { hot, effective, falseRisk, redundant };
}

interface RawZone {
  id: string;
  name: string;
  nodeIds: string[];
  leadId: string;
  centroid: { lat: number; lon: number };
  radiusKm: number;
  meanEffective: number;
  dominant: { id: DriverId; mean: number }[];
  opposing: { id: DriverId; mean: number }[];
  falseRisk: boolean;
  redundant: string[];
  marginal: boolean;
  column: string;
}

function cluster(
  states: NodeState[],
): RawZone[] {
  const cand = states
    .filter((s) => s.effective >= 2.2 && s.hot.length >= 2)
    .slice()
    .sort((a, b) => b.effective - a.effective);
  const used = new Set<string>();
  const zones: RawZone[] = [];
  for (const seed of cand) {
    if (used.has(seed.id)) continue;
    const seedNode = NODES[seed.index];
    if (!seedNode) continue;
    const members = [seed];
    used.add(seed.id);
    for (const other of cand) {
      if (used.has(other.id)) continue;
      const n = NODES[other.index];
      if (!n) continue;
      if (haversine(seedNode.lat, seedNode.lon, n.lat, n.lon) <= 720) {
        members.push(other);
        used.add(other.id);
      }
    }
    if (members.length === 1 && seed.effective < 2.55) continue;
    const center = centroid(
      members.map((m) => {
        const n = NODES[m.index];
        return { lat: n?.lat ?? 0, lon: n?.lon ?? 0, w: m.effective };
      }),
    );
    let radius = 180;
    for (const m of members) {
      const n = NODES[m.index];
      if (!n) continue;
      radius = Math.max(radius, haversine(center.lat, center.lon, n.lat, n.lon));
    }
    const mean = emptyDrivers();
    for (const m of members) for (const k of DRIVER_IDS) mean[k] += m.drivers[k];
    for (const k of DRIVER_IDS) mean[k] /= members.length;
    const ranked = DRIVER_IDS.map((id) => ({ id, mean: mean[id] })).sort((a, b) => b.mean - a.mean);
    const hotShare = (id: DriverId) => members.filter((m) => m.hot.includes(id)).length / members.length;
    const dominant = ranked.filter((r) => hotShare(r.id) >= 0.5).slice(0, 3);
    const opposing = ranked.slice(-2).reverse();
    const redundant = [...new Set(members.flatMap((m) => m.redundant))].slice(0, 3);
    const lead = members.slice().sort((a, b) => b.effective - a.effective)[0];
    const second = members.slice().sort((a, b) => b.effective - a.effective)[1];
    const leadNode = lead ? NODES[lead.index] : undefined;
    const secondNode = second ? NODES[second.index] : undefined;
    let name = leadNode?.name ?? "Zone";
    if (leadNode && secondNode && members.length > 1) {
      const d = haversine(leadNode.lat, leadNode.lon, secondNode.lat, secondNode.lon);
      if (d > 450) name = `${leadNode.name} · ${secondNode.name}`;
    }
    const columns = members.map((m) => m.column);
    const column = mode(columns);
    const meanEffective = members.reduce((a, m) => a + m.effective, 0) / members.length;
    zones.push({
      id: members.map((m) => m.id).sort().join("+"),
      name,
      nodeIds: members.map((m) => m.id),
      leadId: lead?.id ?? seed.id,
      centroid: center,
      radiusKm: radius,
      meanEffective,
      dominant: dominant.length ? dominant : ranked.slice(0, 2),
      opposing,
      falseRisk: members.some((m) => m.falseRisk),
      redundant,
      marginal: meanEffective < 2.55,
      column,
    });
  }
  zones.sort((a, b) => b.meanEffective - a.meanEffective);
  return zones;
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "Surface column";
  let n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return best;
}

function attachScores(
  base: Omit<NodeState, "hot" | "effective" | "falseRisk" | "redundant">[],
  enabled: Record<FieldId, boolean>,
  threshold: number,
  discount: boolean,
): { states: NodeState[]; corr: number[][] } {
  const corr = correlation(base);
  const states: NodeState[] = base.map((s) => ({
    ...s,
    ...scoreNode(s.drivers, enabled, corr, threshold, discount),
  }));
  return { states, corr };
}

function movementOf(curr: RawZone[], prev: RawZone[] | null, older: RawZone[] | null, years: number): Zone[] {
  if (!prev) {
    return curr.map((z) => ({ ...z, movement: null }));
  }
  const owner = new Map<string, number>();
  prev.forEach((z, zi) => z.nodeIds.forEach((id) => owner.set(id, zi)));
  const olderOwner = new Map<string, number>();
  older?.forEach((z, zi) => z.nodeIds.forEach((id) => olderOwner.set(id, zi)));
  const drafts = curr.map((z) => {
    const tally = new Map<number, number>();
    for (const id of z.nodeIds) {
      const p = owner.get(id);
      if (p !== undefined) tally.set(p, (tally.get(p) ?? 0) + 1);
    }
    let best = -1;
    let bestN = 0;
    for (const [p, n] of tally) if (n > bestN) { best = p; bestN = n; }
    return { z, best, tally };
  });
  const bestCount = new Map<number, number>();
  for (const d of drafts) if (d.best >= 0) bestCount.set(d.best, (bestCount.get(d.best) ?? 0) + 1);

  return drafts.map((d) => {
    let status: ZoneMovement["status"] = "new";
    let kmPerDecade = 0;
    let bearing = 0;
    if (d.best >= 0) {
      const p = prev[d.best];
      if (p) {
        const dist = haversine(p.centroid.lat, p.centroid.lon, d.z.centroid.lat, d.z.centroid.lon);
        kmPerDecade = years > 0 ? (dist / years) * 10 : 0;
        bearing = bearingDeg(p.centroid.lat, p.centroid.lon, d.z.centroid.lat, d.z.centroid.lon);
      }
      const sources = [...d.tally.values()].filter((n) => n >= 1).length;
      const split = (bestCount.get(d.best) ?? 0) > 1;
      status = split ? "split" : sources >= 2 ? "merged" : "stable";
    } else if (older) {
      const overlap = d.z.nodeIds.some((id) => olderOwner.has(id));
      if (overlap) status = "reappeared";
    }
    return { ...d.z, movement: { status, kmPerDecade, bearing } };
  });
}

function fieldValue(state: NodeState, flow: FlowId): number | null {
  if (flow === "none") return null;
  if (flow === "utility") return state.utility;
  return state.drivers[flow];
}

function gradients(states: NodeState[], flow: FlowId): Arrow[] {
  if (flow === "none") return [];
  const values = states.map((s) => fieldValue(s, flow) ?? 0);
  const raw: Arrow[] = [];
  states.forEach((s, i) => {
    const node = NODES[i];
    if (!node) return;
    let north = 0;
    let east = 0;
    for (let j = 0; j < states.length; j++) {
      if (i === j) continue;
      const other = NODES[j];
      if (!other) continue;
      const dist = haversine(node.lat, node.lon, other.lat, other.lon);
      if (dist > 2500 || dist < 50) continue;
      const d = (values[j] ?? 0) - (values[i] ?? 0);
      if (d <= 0) continue;
      const brg = (bearingDeg(node.lat, node.lon, other.lat, other.lon) * Math.PI) / 180;
      const w = d / (dist / 900);
      north += Math.cos(brg) * w;
      east += Math.sin(brg) * w;
    }
    const mag = Math.hypot(north, east);
    const bearing = (Math.atan2(east, north) * 180) / Math.PI;
    raw.push({ id: s.id, lat: node.lat, lon: node.lon, bearing, mag });
  });
  const max = Math.max(...raw.map((a) => a.mag), 1e-6);
  return raw
    .map((a) => ({ ...a, mag: a.mag / max }))
    .filter((a) => a.mag > 0.28)
    .sort((a, b) => b.mag - a.mag)
    .slice(0, 22);
}

function flowLines(states: NodeState[], flow: FlowId): string[] {
  if (flow === "none") return ["Gradients are off. Turn a flow on to see which way the field rises."];
  const arrows = gradients(states, flow);
  const label = flow === "utility" ? "land utility" : FIELD_BY_ID[flow].label.toLowerCase();
  const bands = [
    { name: "Northern mid-latitudes", test: (lat: number) => lat > 25 },
    { name: "The tropics", test: (lat: number) => Math.abs(lat) <= 20 },
    { name: "Southern mid-latitudes", test: (lat: number) => lat < -25 },
  ];
  return bands.map((b) => {
    const subset = arrows.filter((a) => {
      const n = NODES.find((x) => x.id === a.id);
      return n ? b.test(n.lat) : false;
    });
    if (subset.length < 2) {
      return `${b.name}: too few strong ${label} gradients to read a direction.`;
    }
    let north = 0;
    let east = 0;
    for (const a of subset) {
      const r = (a.bearing * Math.PI) / 180;
      north += Math.cos(r) * a.mag;
      east += Math.sin(r) * a.mag;
    }
    const mean = (Math.atan2(east, north) * 180) / Math.PI;
    return `${b.name}: the ${label} field rises toward the ${compass(mean)}, on average. That is a slope of the field, not a forecast that people, firms, or armies move that way.`;
  });
}

function chaosOf(t: number, scenario: Scenario, gain: number): Snapshot["chaos"] {
  if (t < 0.02) {
    return {
      lambdaPerYear: 0,
      ratio: 1,
      reading:
        "At the present encoding there is no elapsed time in which divergence could accumulate. Advance the year to test it.",
    };
  }
  const base = evaluate(t, scenario, gain).map((s) => s.utility);
  const bumped = NODES.map((n) => ({
    ...n,
    base: { ...n.base, human: clamp01(n.base.human + 0.02) },
  }));
  const pert = evaluatePerturbed(bumped, t, scenario, gain).map((s) => s.utility);
  let num = 0;
  for (let i = 0; i < base.length; i++) {
    const d = (pert[i] ?? 0) - (base[i] ?? 0);
    num += d * d;
  }
  const ratio = Math.sqrt(num / (base.length * 0.02 * 0.02));
  const years = Math.max(1, t * SPAN);
  const lambdaPerYear = Math.log(Math.max(ratio, 1e-6)) / years;
  let reading: string;
  if (ratio < 1.8 && lambdaPerYear < 0.008) {
    reading =
      "No exponential divergence. A small shock to human capital stays the same size or shrinks. Coupling in this atlas is mostly diffusion and saturation. Chaos is not assumed, and it is not observed here.";
  } else if (lambdaPerYear < 0.02) {
    reading =
      "Perturbations grow modestly, then the clamps stop them. That is sensitivity with a ceiling, not chaos. Do not describe the map as chaotic on this run.";
  } else {
    reading =
      "The finite-time expansion rate is high under these assumptions. Zone edges should be treated as unstable. This is still a property of the chosen equations, not a discovered law of history.";
  }
  return { lambdaPerYear, ratio, reading };
}

function evaluatePerturbed(
  nodes: typeof NODES,
  t: number,
  scenario: Scenario,
  gain: number,
): { utility: number }[] {
  // Local clone of the driver pass using a substituted node table.
  const saved = NODES.map((n) => ({ base: n.base, slope: n.slope }));
  for (let i = 0; i < NODES.length; i++) {
    const src = nodes[i];
    const dst = NODES[i];
    if (!src || !dst) continue;
    dst.base = src.base;
    dst.slope = src.slope;
  }
  try {
    return evaluate(t, scenario, gain);
  } finally {
    for (let i = 0; i < NODES.length; i++) {
      const dst = NODES[i];
      const prev = saved[i];
      if (!dst || !prev) continue;
      dst.base = prev.base;
      dst.slope = prev.slope;
    }
  }
}

function lensValue(state: NodeState, lens: SnapshotInput["lens"]): number {
  if (lens === "convergence") return clamp01(state.effective / 4.2);
  if (lens === "utility") return state.utility;
  return state.drivers[lens];
}

export function computeSnapshot(input: SnapshotInput): Snapshot {
  const scenario = SCENARIO_BY_ID[input.scenarioId];
  const t = clamp01((input.year - EPOCH) / SPAN);
  const nowBase = evaluate(t, scenario, input.gain);
  const { states, corr } = attachScores(nowBase, input.enabled, input.threshold, input.discount);
  const dt = 0.04;
  const prev =
    t > 0.05
      ? attachScores(evaluate(Math.max(0, t - dt), scenario, input.gain), input.enabled, input.threshold, input.discount).states
      : null;
  const older =
    t > 0.22
      ? attachScores(evaluate(Math.max(0, t - 0.2), scenario, input.gain), input.enabled, input.threshold, input.discount).states
      : null;
  const currZones = cluster(states);
  const prevZones = prev ? cluster(prev) : null;
  const olderZones = older ? cluster(older) : null;
  const zones = movementOf(currZones, prevZones, olderZones, dt * SPAN);

  const t0 = attachScores(evaluate(0, scenario, input.gain), input.enabled, input.threshold, input.discount).states;
  const basinMap = new Map<BasinId, { u: number; u0: number; n: number }>();
  states.forEach((s, i) => {
    const basin = NODES[i]?.basin;
    if (!basin) return;
    const row = basinMap.get(basin) ?? { u: 0, u0: 0, n: 0 };
    row.u += s.utility;
    row.u0 += t0[i]?.utility ?? s.utility;
    row.n += 1;
    basinMap.set(basin, row);
  });
  const basinRanks = [...basinMap.entries()]
    .map(([basin, v]) => ({
      basin,
      label: BASIN_LABEL[basin],
      utility: v.u / v.n,
      delta: v.u / v.n - v.u0 / v.n,
      count: v.n,
    }))
    .sort((a, b) => b.utility - a.utility);

  const utilityOrder = states.map((s, i) => ({ i, u: s.utility })).sort((a, b) => b.u - a.u);
  const convOrder = states.map((s, i) => ({ i, e: s.effective })).sort((a, b) => b.e - a.e);
  const uRank = new Map<number, number>();
  const cRank = new Map<number, number>();
  utilityOrder.forEach((r, k) => uRank.set(r.i, k + 1));
  convOrder.forEach((r, k) => cRank.set(r.i, k + 1));
  const mexico = states
    .filter((_, i) => NODES[i]?.mexicoTest)
    .map((s) => ({
      id: s.id,
      name: NODES[s.index]?.name ?? s.id,
      utilityRank: uRank.get(s.index) ?? 0,
      convergenceRank: cRank.get(s.index) ?? 0,
      utility: s.utility,
      effective: s.effective,
    }));

  const redundantPairs: Snapshot["redundantPairs"] = [];
  for (let i = 0; i < DRIVER_IDS.length; i++) {
    for (let j = i + 1; j < DRIVER_IDS.length; j++) {
      const r = corr[i]?.[j] ?? 0;
      const a = DRIVER_IDS[i];
      const b = DRIVER_IDS[j];
      if (a && b && r > 0.72) redundantPairs.push({ a, b, r });
    }
  }

  const leader = zones[0]?.name ?? "No multi-field zone clears the threshold";

  return {
    year: input.year,
    t,
    scenario,
    states,
    byId: new Map(states.map((s) => [s.id, s])),
    corr,
    redundantPairs,
    zones,
    lens: states.map((s) => lensValue(s, input.lens)),
    arrows: gradients(states, input.flow),
    basinRanks,
    flowLines: flowLines(states, input.flow),
    mexico,
    leader,
    chaos: chaosOf(t, scenario, input.gain),
  };
}

export interface HorizonRow {
  offset: number;
  year: number;
  utility: number;
  effective: number;
  hot: DriverId[];
  note?: string;
}

export interface PlaceBrief {
  gain: string;
  assets: string;
  control: string;
  ownershipClass: string;
  ownershipText: string;
  horizons: HorizonRow[];
  robust: string;
  uncertain: string;
  leaveOneOut: { field: string; id: DriverId; effective: number; dissolves: boolean }[];
  assumptions: { k: string; v: string }[];
  sensitivity: { name: string; delta: number }[];
  band: { p10: number; p50: number; p90: number };
  separable: string;
  opposing: string;
  converging: string;
  series: ({ year: number; utility: number } & Drivers)[];
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (i - lo);
}

function ownershipOf(index: number, presentU: number, futureU: number): { cls: string; text: string } {
  const n = NODES[index];
  if (!n) return { cls: "ordinary present-day", text: "" };
  const surface = 0.55 * n.base.human + 0.25 * n.agri + 0.2 * n.pop;
  const option = 0.42 * n.minerals + 0.38 * n.solar + 0.2 * n.water;
  const ratio = n.base.corporate / (surface + 0.2);
  if (ratio > 1.45 && surface < 0.42 && option > 0.55) {
    return {
      cls: "Unresolved option",
      text: "Control is intense relative to present surface productivity, and the assets are mostly minerals, solar, or water rather than a dense economy. That is what an ordinary mining or desert-energy province looks like. It is also what future-optimized positioning would look like. The map cannot tell those apart. No intent is inferred. Independent evidence would be required, and none is supplied here.",
    };
  }
  if (futureU - presentU > 0.08 && n.base.corporate > 0.48 && surface >= 0.4) {
    return {
      cls: "Incidental later benefit",
      text: "Today's control is already explained by present production, infrastructure, or an already-economic resource. If utility rises later, current holders would benefit. That benefit is not evidence they positioned for this scenario.",
    };
  }
  return {
    cls: "Ordinary present-day",
    text: "Ownership and operating control line up with current productivity, infrastructure, or a resource that is already economic. The atlas treats this as present-day positioning.",
  };
}

export function describePlace(index: number, input: SnapshotInput, snap: Snapshot): PlaceBrief {
  const node = NODES[index];
  const state = snap.states[index];
  if (!node || !state) {
    return emptyBrief();
  }
  const scenario = snap.scenario;
  const present = evaluate(0, scenario, input.gain)[index];
  const presentU = present?.utility ?? state.utility;
  const deltas = state.parts.map((p) => {
    const before = present?.parts.find((q) => q.key === p.key)?.contribution ?? p.contribution;
    return { label: p.label, d: p.contribution - before, now: p.contribution };
  });
  deltas.sort((a, b) => b.d - a.d);
  const up = deltas[0];
  const down = deltas[deltas.length - 1];
  const du = state.utility - presentU;
  const dir = du > 0.03 ? "rises" : du < -0.03 ? "falls" : "barely moves";
  const gain =
    Math.abs(du) < 0.005
      ? `Under ${scenario.label.toLowerCase()}, utility is flat from 2026 to ${input.year} at the precision this atlas reports. Component shifts are smaller than 0.01. The weights still depend on the scenario, so this is not a ranking.`
      : `Under ${scenario.label.toLowerCase()}, utility ${dir} by ${fmtDelta(du)} from 2026 to ${input.year}. Largest lift: ${up?.label.toLowerCase() ?? "none"} (${fmtDelta(up?.d ?? 0)}). Largest drag: ${down?.label.toLowerCase() ?? "none"} (${fmtDelta(down?.d ?? 0)}). Weights themselves change with the scenario, so this is not a single-number ranking.`;

  const own = ownershipOf(index, presentU, state.utility);
  const hot = state.hot.map((id) => `${FIELD_BY_ID[id].label.toLowerCase()} ${state.drivers[id].toFixed(2)}`);
  const converging = hot.length
    ? `Counted fields at or above ${input.threshold.toFixed(2)}: ${hot.join("; ")}. Effective overlap after redundancy discount: ${state.effective.toFixed(2)}. ${state.falseRisk ? "At least two of those fields move together globally, so the overlap is partly the same phenomenon counted twice." : "The hot fields are not strongly redundant in the global cross-section."} ${state.column}.`
    : `No independent field is above the threshold of ${input.threshold.toFixed(2)}. This place can still have high utility. Utility is derived and is not allowed to vote in the overlap count.`;

  const opposingIds = DRIVER_IDS.slice().sort((a, b) => state.drivers[a] - state.drivers[b]).slice(0, 2);
  const opposing = `The weak fields here are ${opposingIds.map((id) => `${FIELD_BY_ID[id].label.toLowerCase()} (${state.drivers[id].toFixed(2)})`).join(" and ")}. They are why a high score on one axis does not become a convergence zone by itself.`;

  const horizons: HorizonRow[] = [];
  const samples: { year: number; utility: number; effective: number }[] = [];
  for (const offset of [0, ...HORIZON_OFFSETS]) {
    const year = EPOCH + offset;
    const tt = offset / SPAN;
    const ev = evaluate(tt, scenario, input.gain);
    const scored = scoreNode(
      ev[index]?.drivers ?? state.drivers,
      input.enabled,
      correlation(ev),
      input.threshold,
      input.discount,
    );
    const utility = ev[index]?.utility ?? 0;
    samples.push({ year, utility, effective: scored.effective });
    horizons.push({
      offset,
      year,
      utility,
      effective: scored.effective,
      hot: scored.hot,
    });
  }
  const h230 = horizons.find((h) => h.offset === 230);
  const h240 = horizons.find((h) => h.offset === 240);
  if (h230 && h240 && Math.abs(h240.utility - h230.utility) < 0.03) {
    h240.note = "Not separable from +230. Ten years is inside the smoothness of these drifts.";
  }

  const spread = (Object.keys(SCENARIO_BY_ID) as ScenarioId[]).map((id) => {
    const sc = SCENARIO_BY_ID[id];
    const ev = evaluate(snap.t, sc, input.gain);
    const scored = scoreNode(ev[index]?.drivers ?? emptyDrivers(), input.enabled, correlation(ev), input.threshold, input.discount);
    return { id, label: sc.label, utility: ev[index]?.utility ?? 0, drivers: ev[index]?.drivers ?? emptyDrivers(), effective: scored.effective, hot: scored.hot };
  });
  const robustBits: string[] = [];
  const fragileBits: string[] = [];
  for (const id of DRIVER_IDS) {
    if (!input.enabled[id]) continue;
    const vals = spread.map((s) => s.drivers[id]);
    const hi = Math.max(...vals);
    const lo = Math.min(...vals);
    const nHot = spread.filter((s) => s.hot.includes(id)).length;
    if (nHot >= 5) robustBits.push(`${FIELD_BY_ID[id].short} stays hot in ${nHot} of 7 scenarios`);
    else if (hi - lo > 0.16) fragileBits.push(`${FIELD_BY_ID[id].short} swings ${lo.toFixed(2)}–${hi.toFixed(2)}`);
  }
  const uLo = Math.min(...spread.map((s) => s.utility));
  const uHi = Math.max(...spread.map((s) => s.utility));
  const robust = [
    robustBits.length ? `Robust: ${robustBits.join("; ")}.` : "No driver stays above the threshold in five or more scenarios.",
    fragileBits.length ? `Scenario-contingent: ${fragileBits.join("; ")}.` : "Enabled drivers do not swing widely across scenarios.",
    `Utility across the seven scenarios spans ${uLo.toFixed(2)}–${uHi.toFixed(2)} at this year.`,
  ].join(" ");

  const rnd = mulberry32(hashString(`${node.id}|${input.year}|${scenario.id}|${input.gain.toFixed(2)}`) ^ 0x9e3779b9);
  const samplesU: number[] = [];
  const originals = NODES.map((n) => ({
    base: { ...n.base },
    slope: { ...n.slope },
    water: n.water,
    minerals: n.minerals,
    solar: n.solar,
  }));
  try {
    for (let s = 0; s < 18; s++) {
      for (const n of NODES) {
        for (const k of DRIVER_IDS) {
          n.base[k] = clamp01(originals[NODES.indexOf(n)]!.base[k] + (rnd() - 0.5) * 0.1);
          n.slope[k] = originals[NODES.indexOf(n)]!.slope[k] * (0.78 + rnd() * 0.44);
        }
        const o = originals[NODES.indexOf(n)]!;
        n.water = clamp01(o.water + (rnd() - 0.5) * 0.08);
        n.minerals = clamp01(o.minerals + (rnd() - 0.5) * 0.08);
        n.solar = clamp01(o.solar + (rnd() - 0.5) * 0.08);
      }
      const ev = evaluate(snap.t, scenario, input.gain);
      samplesU.push(ev[index]?.utility ?? state.utility);
    }
  } finally {
    for (let i = 0; i < NODES.length; i++) {
      const n = NODES[i];
      const o = originals[i];
      if (!n || !o) continue;
      n.base = o.base;
      n.slope = o.slope;
      n.water = o.water;
      n.minerals = o.minerals;
      n.solar = o.solar;
    }
  }
  samplesU.sort((a, b) => a - b);
  const band = { p10: quantile(samplesU, 0.1), p50: quantile(samplesU, 0.5), p90: quantile(samplesU, 0.9) };

  const sensitivity: { name: string; delta: number }[] = [];
  for (const knob of KNOB_LABELS) {
    const upS = { ...scenario, [knob.key]: Number(scenario[knob.key]) * 1.25 };
    const dnS = { ...scenario, [knob.key]: Number(scenario[knob.key]) * 0.75 };
    const uUp = evaluate(snap.t, upS, input.gain)[index]?.utility ?? state.utility;
    const uDn = evaluate(snap.t, dnS, input.gain)[index]?.utility ?? state.utility;
    sensitivity.push({ name: knob.label, delta: uUp - uDn });
  }
  const gUp = evaluate(snap.t, scenario, clamp01(input.gain + 0.2))[index]?.utility ?? state.utility;
  const gDn = evaluate(snap.t, scenario, Math.max(0, input.gain - 0.2))[index]?.utility ?? state.utility;
  sensitivity.push({ name: "Spatial coupling", delta: gUp - gDn });
  sensitivity.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const width = band.p90 - band.p10;
  let nearest = state;
  let nearestGap = Infinity;
  for (const other of snap.states) {
    if (other.id === state.id) continue;
    const gap = Math.abs(other.utility - state.utility);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = other;
    }
  }
  const nearNode = NODES[nearest.index];
  const separable =
    nearestGap < Math.max(0.03, width * 0.85)
      ? `Utility here (${state.utility.toFixed(2)}) sits inside the same uncertainty band as ${nearNode?.name ?? "a neighbor"} (${nearest.utility.toFixed(2)}). The atlas will not rank them. Band p10–p90 is ${band.p10.toFixed(2)}–${band.p90.toFixed(2)}.`
      : `The gap to the nearest utility peer (${nearNode?.name ?? "nearby"}, ${nearestGap.toFixed(2)}) is wider than this node's Monte Carlo band (${width.toFixed(2)}). The separation is still conditional on the scenario.`;

  const topKnob = sensitivity[0];
  const uncertain = `The assumption that moves this place most is ${topKnob?.name.toLowerCase() ?? "unidentified"} (utility change ${fmtDelta(topKnob?.delta ?? 0)} when the knob is swung ±25%). Monte Carlo noise on baselines (±0.05) and slopes gives utility p10–p90 of ${band.p10.toFixed(2)}–${band.p90.toFixed(2)}. ${h240?.note ?? ""}`;

  const leaveOneOut = DRIVER_IDS.filter((id) => input.enabled[id]).map((id) => {
    const nextEnabled = { ...input.enabled, [id]: false };
    const scored = scoreNode(state.drivers, nextEnabled, snap.corr, input.threshold, input.discount);
    return {
      field: FIELD_BY_ID[id].label,
      id,
      effective: scored.effective,
      dissolves: state.effective >= 2.2 && scored.effective < 2.2,
    };
  });

  const assumptions = [
    { k: "Meteorology", v: scenario.blurb + " Freshwater includes a coastal desalination term. It does not invent rainfall." },
    { k: "Technology", v: `Unlock ${scenario.techUnlock.toFixed(2)}, substitution ${scenario.substitution.toFixed(2)}. Solar and newly economic minerals enter the resource field. A present battery-metal boom is penalized when substitution is high.` },
    { k: "Infrastructure", v: `Build multiplier ${scenario.infraBuild.toFixed(2)}. Corridors and coasts gain access faster than inland places. Climate pressure adds a maintenance drag where access is already thin.` },
    { k: "Society and institutions", v: `Human-capital diffusion ${scenario.humanDiffusion.toFixed(2)}, institutional drift ${scenario.institutionalDrift.toFixed(2)}. Aging slopes are shallower where skills are deep. No scenario redraws a border.` },
  ];

  const series = [];
  for (let y = EPOCH; y <= EPOCH + SPAN; y += 20) {
    const ev = evaluate((y - EPOCH) / SPAN, scenario, input.gain)[index];
    series.push({
      year: y,
      utility: ev?.utility ?? 0,
      meteo: ev?.drivers.meteo ?? 0,
      resources: ev?.drivers.resources ?? 0,
      human: ev?.drivers.human ?? 0,
      infra: ev?.drivers.infra ?? 0,
      corporate: ev?.drivers.corporate ?? 0,
      institutions: ev?.drivers.institutions ?? 0,
    });
  }

  return {
    gain,
    assets: node.assets,
    control: node.control,
    ownershipClass: own.cls,
    ownershipText: own.text,
    horizons,
    robust,
    uncertain,
    leaveOneOut,
    assumptions,
    sensitivity: sensitivity.slice(0, 4),
    band,
    separable,
    opposing,
    converging,
    series,
  };
}

function fmtDelta(d: number): string {
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}`;
}

function emptyBrief(): PlaceBrief {
  return {
    gain: "",
    assets: "",
    control: "",
    ownershipClass: "",
    ownershipText: "",
    horizons: [],
    robust: "",
    uncertain: "",
    leaveOneOut: [],
    assumptions: [],
    sensitivity: [],
    band: { p10: 0, p50: 0, p90: 0 },
    separable: "",
    opposing: "",
    converging: "",
    series: [],
  };
}

export function bearingWord(bearing: number, km: number): string {
  if (km < 40) return "quasi-stationary";
  return `drifting ${compass(bearing)}`;
}
