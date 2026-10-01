export type ScenarioId =
  | "baseline"
  | "highTech"
  | "resourceConstrained"
  | "climateStressed"
  | "highHuman"
  | "infraAccel"
  | "disruptive";

export interface Scenario {
  id: ScenarioId;
  label: string;
  blurb: string;
  /** Poleward climate pressure and hydrological stress. 0.55 ≈ moderate baseline. */
  climate: number;
  /** Depletion of already-economic hydrocarbons and easy ore. */
  depletion: number;
  /** Rate at which solar, deeper minerals, recycling, and desalination become economic. */
  techUnlock: number;
  /** How strongly skill stocks diffuse and offset aging. */
  humanDiffusion: number;
  /** Infrastructure build-out relative to maintenance. */
  infraBuild: number;
  /** How fast institutional predictability erodes where it is already weak. */
  institutionalDrift: number;
  /** Reach of durable corporate and asset-control networks. */
  corporateReach: number;
  /** Substitution away from today's commodity mix. */
  substitution: number;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "baseline",
    label: "Baseline",
    blurb: "Moderate warming, partial substitution, institutions drift where they are already thin. No designated winner.",
    climate: 0.55,
    depletion: 1,
    techUnlock: 0.55,
    humanDiffusion: 1,
    infraBuild: 0.7,
    institutionalDrift: 0.45,
    corporateReach: 0.7,
    substitution: 0.45,
  },
  {
    id: "highTech",
    label: "High technology",
    blurb: "Faster mitigation, desalination, and energy substitution. Today's commodity rents fade sooner.",
    climate: 0.38,
    depletion: 0.72,
    techUnlock: 1.25,
    humanDiffusion: 1.12,
    infraBuild: 1.12,
    institutionalDrift: 0.32,
    corporateReach: 1.02,
    substitution: 1.05,
  },
  {
    id: "resourceConstrained",
    label: "Resource constraint",
    blurb: "Slow substitution, faster depletion, harder build-out. Geological endowment matters more, and so does its exhaustion.",
    climate: 0.7,
    depletion: 1.35,
    techUnlock: 0.32,
    humanDiffusion: 0.9,
    infraBuild: 0.5,
    institutionalDrift: 0.72,
    corporateReach: 0.82,
    substitution: 0.22,
  },
  {
    id: "climateStressed",
    label: "Climate stress",
    blurb: "Stronger heat, water, and coastal pressure. Habitability shifts are not assumed to dictate settlement.",
    climate: 1.28,
    depletion: 0.95,
    techUnlock: 0.58,
    humanDiffusion: 0.88,
    infraBuild: 0.58,
    institutionalDrift: 0.85,
    corporateReach: 0.74,
    substitution: 0.5,
  },
  {
    id: "highHuman",
    label: "Human capital",
    blurb: "Skills diffuse and aging bites less where skill stocks are already deep. Population size still does not count as skill.",
    climate: 0.5,
    depletion: 0.9,
    techUnlock: 0.78,
    humanDiffusion: 1.48,
    infraBuild: 0.88,
    institutionalDrift: 0.28,
    corporateReach: 0.8,
    substitution: 0.7,
  },
  {
    id: "infraAccel",
    label: "Infrastructure",
    blurb: "Corridors, ports, grids, and desalination are built faster. Position in the network gains weight.",
    climate: 0.5,
    depletion: 0.85,
    techUnlock: 0.9,
    humanDiffusion: 1.05,
    infraBuild: 1.5,
    institutionalDrift: 0.38,
    corporateReach: 1.12,
    substitution: 0.72,
  },
  {
    id: "disruptive",
    label: "Disruptive technology",
    blurb: "Strong substitution against single-commodity regions. Solar and skills gain; a present mining boom is not a 300-year annuity.",
    climate: 0.42,
    depletion: 0.6,
    techUnlock: 1.42,
    humanDiffusion: 1.2,
    infraBuild: 1.18,
    institutionalDrift: 0.5,
    corporateReach: 1.15,
    substitution: 1.42,
  },
];

export const SCENARIO_BY_ID: Record<ScenarioId, Scenario> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
) as Record<ScenarioId, Scenario>;

export const KNOB_LABELS: { key: keyof Scenario; label: string }[] = [
  { key: "climate", label: "Climate pressure" },
  { key: "depletion", label: "Depletion" },
  { key: "techUnlock", label: "Technology unlock" },
  { key: "humanDiffusion", label: "Human-capital diffusion" },
  { key: "infraBuild", label: "Infrastructure build" },
  { key: "institutionalDrift", label: "Institutional drift" },
  { key: "corporateReach", label: "Corporate reach" },
  { key: "substitution", label: "Substitution" },
];
