import { useMemo } from "react";
import { EarthCanvas } from "@/components/earth-canvas";
import { MethodPanel, PlacePanel, ZonesPanel } from "@/components/inspector";
import { computeSnapshot, describePlace } from "@/lib/model/engine";
import { NODES } from "@/lib/model/nodes";
import { SCENARIOS, type ScenarioId } from "@/lib/model/scenarios";
import { useAtlas, type Lens } from "@/lib/model/store";
import {
  EPOCH,
  FIELD_BY_ID,
  FIELDS,
  HORIZON_OFFSETS,
  SPAN,
  type FieldId,
  type FlowId,
} from "@/lib/model/types";

const FLOW_CHOICES: { id: FlowId; label: string }[] = [
  { id: "none", label: "Off" },
  { id: "utility", label: "Utility" },
  { id: "meteo", label: "Meteo" },
  { id: "resources", label: "Resources" },
  { id: "human", label: "Human" },
  { id: "infra", label: "Access" },
  { id: "corporate", label: "Control" },
  { id: "institutions", label: "Institutions" },
];

export function AtlasApp() {
  const ui = useAtlas();
  const snap = useMemo(
    () =>
      computeSnapshot({
        year: ui.year,
        scenarioId: ui.scenarioId,
        gain: ui.gain,
        threshold: ui.threshold,
        enabled: ui.enabled,
        discount: ui.discount,
        flow: ui.flow,
        lens: ui.lens,
      }),
    [ui.year, ui.scenarioId, ui.gain, ui.threshold, ui.enabled, ui.discount, ui.flow, ui.lens],
  );

  const selected = snap.states.find((s) => s.id === ui.selectedId) ?? null;
  const brief = useMemo(() => {
    if (!selected) return null;
    return describePlace(
      selected.index,
      {
        year: ui.year,
        scenarioId: ui.scenarioId,
        gain: ui.gain,
        threshold: ui.threshold,
        enabled: ui.enabled,
        discount: ui.discount,
        flow: ui.flow,
        lens: ui.lens,
      },
      snap,
    );
  }, [selected, ui.year, ui.scenarioId, ui.gain, ui.threshold, ui.enabled, ui.discount, ui.flow, ui.lens, snap]);

  const zone = snap.zones.find((z) => z.nodeIds.includes(ui.selectedId ?? "")) ?? null;
  const signature = `${ui.lens}:${snap.lens.map((v) => v.toFixed(3)).join(",")}`;
  const scenario = snap.scenario;
  const anyDriver = FIELDS.some((f) => !f.derived && ui.enabled[f.id]);

  return (
    <div className="atlas-shell">
      <header className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-widest text-brass">FIELD MODEL · {EPOCH}–{EPOCH + SPAN}</p>
            <h1 className="font-display text-3xl leading-none text-fg">Isopleth</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="chip"
              aria-pressed={ui.projection === "globe"}
              onClick={() => ui.setProjection("globe")}
            >
              Globe
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={ui.projection === "plate"}
              onClick={() => ui.setProjection("plate")}
            >
              Plate
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={ui.panel === "method"}
              onClick={() => ui.setPanel(ui.panel === "method" ? "zones" : "method")}
            >
              Method
            </button>
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          A scenario instrument for where independent Earth systems overlap. Not a forecast of conflict, migration, or intent.
        </p>
      </header>

      <div className="atlas-body">
        <aside className="side side-left">
          <div className="panel-scroll px-3 py-3">
            <p className="font-mono text-xs tracking-widest text-brass">SCENARIO</p>
            <div className="chip-row mt-1 flex flex-col gap-1">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip"
                  aria-pressed={ui.scenarioId === s.id}
                  onClick={() => ui.setScenario(s.id as ScenarioId)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{scenario.blurb}</p>

            <p className="mt-4 font-mono text-xs tracking-widest text-brass">MAP LENS</p>
            <button
              type="button"
              className="chip mt-1 w-full"
              aria-pressed={ui.lens === "convergence"}
              onClick={() => ui.setLens("convergence")}
            >
              Overlap of enabled fields
            </button>

            <p className="mt-4 font-mono text-xs tracking-widest text-brass">FIELDS</p>
            <ul className="mt-1">
              {FIELDS.map((f) => {
                const value = selected
                  ? f.id === "utility"
                    ? selected.utility
                    : selected.drivers[f.id]
                  : null;
                return (
                  <li key={f.id} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      className="chip min-w-0 flex-1"
                      aria-pressed={ui.lens === f.id}
                      disabled={!ui.enabled[f.id]}
                      onClick={() => ui.setLens(f.id as Lens)}
                    >
                      <span className="flex items-center gap-2">
                        <i className={`swatch ${swatchClass(f.id)}`} />
                        <span>
                          {f.short}
                          {f.derived ? " · derived" : ""}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="chip w-16 shrink-0 px-2 text-center font-mono text-xs"
                      aria-pressed={ui.enabled[f.id]}
                      aria-label={`${ui.enabled[f.id] ? "Hide" : "Show"} ${f.label}`}
                      onClick={() => ui.toggleField(f.id)}
                    >
                      {value === null ? (ui.enabled[f.id] ? "On" : "Off") : value.toFixed(2)}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-xs text-faint">
              Left selects the lens. Right includes the field. Utility never votes in the overlap count.
            </p>

            <label className="mt-4 block">
              <span className="flex justify-between font-mono text-xs text-brass">
                <span>THRESHOLD</span>
                <span className="tabular-nums text-fg">{ui.threshold.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0.45}
                max={0.8}
                step={0.01}
                value={ui.threshold}
                aria-label="Convergence threshold"
                onChange={(e) => ui.setThreshold(Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="flex justify-between font-mono text-xs text-brass">
                <span>COUPLING</span>
                <span className="tabular-nums text-fg">{ui.gain.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={ui.gain}
                aria-label="Spatial coupling"
                onChange={(e) => ui.setGain(Number(e.target.value))}
              />
            </label>
            <p className="text-xs text-faint">Coupling pulls neighboring places toward each other. It is diffusion, not a chaos switch.</p>
            <button
              type="button"
              className="chip mt-2 w-full"
              aria-pressed={ui.discount}
              onClick={() => ui.setDiscount(!ui.discount)}
            >
              {ui.discount ? "Redundant fields discounted" : "Redundant fields counted full"}
            </button>

            <p className="mt-4 font-mono text-xs tracking-widest text-brass">GRADIENT</p>
            <div className="chip-row mt-1 flex flex-col gap-1">
              {FLOW_CHOICES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="chip"
                  aria-pressed={ui.flow === f.id}
                  onClick={() => ui.setFlow(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-faint">Arrows point uphill in that field. They are not flows of people or capital.</p>
          </div>
        </aside>

        <section className="stage" aria-label="Earth">
          <EarthCanvas
            lens={anyDriver || ui.enabled.utility ? snap.lens : snap.lens.map(() => 0)}
            signature={signature}
            zones={snap.zones}
            arrows={snap.arrows}
            selectedId={ui.selectedId}
            projection={ui.projection}
            onPick={ui.select}
          />
          <div className="pointer-events-none absolute top-3 left-3">
            <p className="font-mono text-xs text-brass">{ui.lens === "convergence" ? "OVERLAP" : FIELD_BY_ID[ui.lens].short.toUpperCase()}</p>
            <p className="font-display text-5xl leading-none text-fg tabular-nums">{ui.year}</p>
            <p className="font-mono text-xs text-brass-2">{scenario.label}</p>
          </div>
          <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex items-end justify-between gap-3">
            <p className="max-w-xs text-xs text-brass-2">
              {ui.projection === "globe" ? "Drag to turn. Scroll to zoom. Click a place." : "Plate carrée stretches high latitudes. Click a place."}
            </p>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="font-mono text-xs text-faint">Low</span>
              <span className="legend-ramp" />
              <span className="font-mono text-xs text-faint">High</span>
            </div>
          </div>
        </section>

        <aside className="side side-right">
          {ui.panel === "method" ? (
            <MethodPanel snap={snap} />
          ) : ui.panel === "place" && selected && brief ? (
            <PlacePanel
              brief={brief}
              name={NODES[selected.index]?.name ?? selected.id}
              zone={zone}
              parts={selected.parts}
              enabled={ui.enabled}
              onBack={() => ui.setPanel("zones")}
            />
          ) : (
            <ZonesPanel snap={snap} selectedId={ui.selectedId} onSelect={ui.select} />
          )}
        </aside>
      </div>

      <footer className="timeline px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="chip" aria-pressed={ui.year === EPOCH} onClick={() => ui.setYear(EPOCH)}>
            Now
          </button>
          {HORIZON_OFFSETS.map((offset) => (
            <button
              key={offset}
              type="button"
              className="chip"
              aria-pressed={ui.year === EPOCH + offset}
              onClick={() => ui.setYear(EPOCH + offset)}
            >
              +{offset}
            </button>
          ))}
        </div>
        <label className="mt-1 block">
          <span className="sr-only">Year</span>
          <input
            type="range"
            min={EPOCH}
            max={EPOCH + SPAN}
            step={1}
            value={ui.year}
            aria-label="Year"
            aria-valuetext={`${ui.year}`}
            onChange={(e) => ui.setYear(Number(e.target.value))}
          />
        </label>
        <p className="font-mono text-xs text-faint">
          Continuous between bookmarks. +230 and +240 are ten years apart on purpose: if the atlas cannot separate them, it says so.
        </p>
      </footer>
    </div>
  );
}

function swatchClass(id: FieldId): string {
  if (id === "utility") return "bg-brass";
  if (id === "meteo") return "bg-field-meteo";
  if (id === "resources") return "bg-field-resources";
  if (id === "human") return "bg-field-human";
  if (id === "infra") return "bg-field-infra";
  if (id === "corporate") return "bg-field-corporate";
  return "bg-field-institutions";
}
