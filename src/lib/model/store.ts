import { create } from "zustand";
import type { ScenarioId } from "@/lib/model/scenarios";
import type { FieldId, FlowId } from "@/lib/model/types";
import { FIELDS } from "@/lib/model/types";

export type Lens = FieldId | "convergence";
export type ProjectionMode = "globe" | "plate";
export type PanelId = "zones" | "place" | "method";

function allOn(): Record<FieldId, boolean> {
  return Object.fromEntries(FIELDS.map((f) => [f.id, true])) as Record<FieldId, boolean>;
}

interface AtlasUI {
  year: number;
  scenarioId: ScenarioId;
  lens: Lens;
  enabled: Record<FieldId, boolean>;
  flow: FlowId;
  gain: number;
  threshold: number;
  discount: boolean;
  projection: ProjectionMode;
  selectedId: string | null;
  panel: PanelId;
  setYear: (year: number) => void;
  setScenario: (id: ScenarioId) => void;
  setLens: (lens: Lens) => void;
  toggleField: (id: FieldId) => void;
  setFlow: (flow: FlowId) => void;
  setGain: (gain: number) => void;
  setThreshold: (threshold: number) => void;
  setDiscount: (discount: boolean) => void;
  setProjection: (projection: ProjectionMode) => void;
  select: (id: string) => void;
  setPanel: (panel: PanelId) => void;
}

export const useAtlas = create<AtlasUI>((set) => ({
  year: 2026,
  scenarioId: "baseline",
  lens: "convergence",
  enabled: allOn(),
  flow: "utility",
  gain: 0.22,
  threshold: 0.6,
  discount: true,
  projection: "globe",
  selectedId: null,
  panel: "zones",
  setYear: (year) => set({ year }),
  setScenario: (scenarioId) => set({ scenarioId }),
  setLens: (lens) => set({ lens }),
  toggleField: (id) =>
    set((s) => {
      const enabled = { ...s.enabled, [id]: !s.enabled[id] };
      let lens = s.lens;
      if (lens !== "convergence" && !enabled[lens]) lens = "convergence";
      let flow = s.flow;
      if (flow !== "none" && !enabled[flow]) flow = "none";
      return { enabled, lens, flow };
    }),
  setFlow: (flow) => set({ flow }),
  setGain: (gain) => set({ gain }),
  setThreshold: (threshold) => set({ threshold }),
  setDiscount: (discount) => set({ discount }),
  setProjection: (projection) => set({ projection }),
  select: (id) => set({ selectedId: id, panel: "place" }),
  setPanel: (panel) => set({ panel }),
}));
