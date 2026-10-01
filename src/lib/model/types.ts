export const EPOCH = 2026;
export const SPAN = 300;
export const HORIZON_OFFSETS = [40, 80, 120, 230, 240, 300] as const;

export const DRIVER_IDS = [
  "meteo",
  "resources",
  "human",
  "infra",
  "corporate",
  "institutions",
] as const;

export type DriverId = (typeof DRIVER_IDS)[number];
export type FieldId = DriverId | "utility";
export type FlowId = FieldId | "none";

export type BasinId =
  | "north-america"
  | "central-america"
  | "south-america"
  | "europe"
  | "eurasia"
  | "middle-east"
  | "africa"
  | "south-asia"
  | "east-asia"
  | "southeast-asia"
  | "oceania"
  | "arctic"
  | "pacific";

export const BASIN_LABEL: Record<BasinId, string> = {
  "north-america": "North America",
  "central-america": "Central America",
  "south-america": "South America",
  europe: "Europe",
  eurasia: "Eurasia",
  "middle-east": "Middle East",
  africa: "Africa",
  "south-asia": "South Asia",
  "east-asia": "East Asia",
  "southeast-asia": "Southeast Asia",
  oceania: "Oceania",
  arctic: "Arctic",
  pacific: "Pacific islands",
};

export type Drivers = Record<DriverId, number>;

export interface AtlasNode {
  id: string;
  name: string;
  basin: BasinId;
  lat: number;
  lon: number;
  base: Drivers;
  solar: number;
  water: number;
  agri: number;
  minerals: number;
  hydrocarb: number;
  coast: number;
  strategic: number;
  skills: number;
  pop: number;
  extract: number;
  slope: Drivers;
  assets: string;
  control: string;
  /** Explicit hypothesis node. The engine must be free to rank it anywhere. */
  mexicoTest?: boolean;
}

export interface FieldMeta {
  id: FieldId;
  label: string;
  short: string;
  derived: boolean;
  about: string;
}

export const FIELDS: FieldMeta[] = [
  {
    id: "meteo",
    label: "Meteorology",
    short: "Meteo",
    derived: false,
    about: "Climate operating environment and freshwater reliability. Not land utility, and not a migration forecast.",
  },
  {
    id: "utility",
    label: "Land utility",
    short: "Utility",
    derived: true,
    about: "Derived practical usefulness of a place. Habitability is only one component. A desert can score high.",
  },
  {
    id: "resources",
    label: "Resources",
    short: "Resources",
    derived: false,
    about: "Recoverable energy, minerals, water-linked endowments, and whether technology makes them economic.",
  },
  {
    id: "human",
    label: "Human capital",
    short: "Human",
    derived: false,
    about: "Skills, health-relevant productive capacity, and retention. Population size is a separate attribute and is not this field.",
  },
  {
    id: "infra",
    label: "Infrastructure",
    short: "Access",
    derived: false,
    about: "Connectivity and access: ports, grids, corridors, data, water systems. Not a count of concrete.",
  },
  {
    id: "corporate",
    label: "Corporate & asset control",
    short: "Control",
    derived: false,
    about: "Persistence of ownership and operating control. Distinct from sovereignty. Not a measure of intent.",
  },
  {
    id: "institutions",
    label: "Institutions",
    short: "Institutions",
    derived: false,
    about: "Property rights, regulatory predictability, and stability. Borders are allowed to matter and to change. They are not forecast.",
  },
];

export const FIELD_BY_ID: Record<FieldId, FieldMeta> = Object.fromEntries(
  FIELDS.map((f) => [f.id, f]),
) as Record<FieldId, FieldMeta>;
