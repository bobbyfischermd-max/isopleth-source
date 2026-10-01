import { useEffect, useState, type ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlaceBrief, Snapshot, UtilityPart, Zone } from "@/lib/model/engine";
import { bearingWord } from "@/lib/model/engine";
import { NODES } from "@/lib/model/nodes";
import { DRIVER_IDS, FIELD_BY_ID, FIELDS, type DriverId, type FieldId } from "@/lib/model/types";

const SWATCH: Record<DriverId | string, string> = {
  meteo: "bg-field-meteo",
  resources: "bg-field-resources",
  human: "bg-field-human",
  infra: "bg-field-infra",
  corporate: "bg-field-corporate",
  institutions: "bg-field-institutions",
  surface: "bg-field-meteo",
  option: "bg-field-corporate",
  strategic: "bg-brass",
};

function Tag({ children }: { children: string }) {
  return <span className="tag">{children}</span>;
}

function Block({ question, tag, children }: { question: string; tag: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-base text-fg">{question}</h3>
        <Tag>{tag}</Tag>
      </div>
      <div className="text-sm text-muted">{children}</div>
    </section>
  );
}

export function PlacePanel({
  brief,
  name,
  zone,
  parts,
  enabled,
  onBack,
}: {
  brief: PlaceBrief;
  name: string;
  zone: Zone | null;
  parts: UtilityPart[];
  enabled: Record<FieldId, boolean>;
  onBack: () => void;
}) {
  return (
    <div className="panel-scroll px-4 pb-6">
      <button type="button" className="chip mt-3 px-0 text-brass" onClick={onBack}>
        All zones
      </button>
      <p className="mt-2 font-mono text-xs tracking-widest text-brass">PLACE</p>
      <h2 className="font-display text-3xl leading-tight text-fg">{name}</h2>
      {zone && (
        <p className="mt-1 font-mono text-xs text-muted">
          Inside “{zone.name}” · {zone.column.toLowerCase()} · {Math.round(zone.radiusKm)} km radius
          {zone.movement ? ` · ${moveLabel(zone)}` : ""}
        </p>
      )}
      <div className="mt-3 flex h-2 overflow-hidden bg-surface-2">
        {parts.map((p) => (
          <div
            key={p.key}
            className={SWATCH[p.key] ?? "bg-brass"}
            style={{ width: `${Math.max(0, p.contribution) * 100}%` }}
            title={`${p.label}: ${p.contribution.toFixed(2)}`}
          />
        ))}
      </div>
      <ul className="mt-2">
        {parts
          .slice()
          .sort((a, b) => b.contribution - a.contribution)
          .map((p) => (
            <li key={p.key} className="flex justify-between gap-3 font-mono text-xs text-muted">
              <span>{p.label}</span>
              <span className="tabular-nums text-fg">{p.contribution.toFixed(2)}</span>
            </li>
          ))}
      </ul>
      <Trajectories series={brief.series} enabled={enabled} />
      <Block question="What is converging, and what opposes it?" tag="Projection">
        <p>{brief.converging}</p>
        <p className="mt-2">{brief.opposing}</p>
      </Block>
      <Block question="What causes this place to gain or lose utility?" tag="Projection">
        <p>{brief.gain}</p>
      </Block>
      <Block question="What assets are responsible?" tag="Observation">
        <p>{brief.assets}</p>
      </Block>
      <Block question="Who controls those assets now?" tag="Observation">
        <p>{brief.control}</p>
        <p className="mt-2 text-fg">
          <span className="font-mono text-xs text-brass">{brief.ownershipClass}. </span>
          <Tag>Inference</Tag>
        </p>
        <p className="mt-2">{brief.ownershipText}</p>
      </Block>
      <Block question="What changes at each horizon?" tag="Projection">
        <ul>
          {brief.horizons.map((h) => (
            <li key={h.year} className="border-t border-line py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-xs text-brass">{h.offset === 0 ? "Now" : `+${h.offset}`}</span>
                <span className="font-mono text-xs tabular-nums text-fg">{h.year}</span>
                <span className="font-mono text-xs tabular-nums text-muted">
                  U {h.utility.toFixed(2)} · overlap {h.effective.toFixed(2)}
                </span>
              </div>
              <p className="mt-1 text-xs">
                {h.hot.length ? h.hot.map((id) => FIELD_BY_ID[id].short).join(" · ") : "No field clears the threshold."}
              </p>
              {h.note && <p className="mt-1 text-xs text-brass-2">{h.note}</p>}
            </li>
          ))}
        </ul>
      </Block>
      <Block question="Which variables are robust across scenarios?" tag="Projection">
        <p>{brief.robust}</p>
      </Block>
      <Block question="Which variables drive the uncertainty?" tag="Projection">
        <p>{brief.uncertain}</p>
        <p className="mt-2">{brief.separable}</p>
        <ul className="mt-2">
          {brief.sensitivity.map((s) => (
            <li key={s.name} className="mt-1">
              <div className="flex justify-between font-mono text-xs text-fg">
                <span>{s.name}</span>
                <span className="tabular-nums">
                  {s.delta > 0 ? "+" : ""}
                  {s.delta.toFixed(2)}
                </span>
              </div>
              <div className="mt-1 h-1 bg-surface-2">
                <div
                  className="h-1 bg-brass"
                  style={{ width: `${Math.min(100, Math.abs(s.delta) * 280)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Block>
      <Block question="What disappears when one field is removed?" tag="Inference">
        <ul>
          {brief.leaveOneOut.map((row) => (
            <li key={row.id} className="mt-1 flex justify-between gap-3 text-sm">
              <span>{row.field}</span>
              <span className="font-mono text-xs tabular-nums text-fg">
                {row.effective.toFixed(2)}
                {row.dissolves ? " · overlap fails" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Block>
      <Block question="Which assumptions does this require?" tag="Projection">
        <ul>
          {brief.assumptions.map((a) => (
            <li key={a.k} className="mt-2">
              <span className="text-fg">{a.k}. </span>
              {a.v}
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}

function Trajectories({
  series,
  enabled,
}: {
  series: PlaceBrief["series"];
  enabled: Record<FieldId, boolean>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="mt-4 h-40 bg-surface" />;
  return (
    <div className="mt-4 h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="year"
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.5, 1]}
            width={28}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value, name) => {
              const n = typeof value === "number" ? value.toFixed(2) : String(value ?? "");
              return [n, String(name)];
            }}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 8,
              color: "var(--color-fg)",
              fontSize: 12,
            }}
          />
          {enabled.utility && (
            <Line type="monotone" dataKey="utility" name="Utility" stroke="var(--color-brass)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
          )}
          {DRIVER_IDS.filter((id) => enabled[id]).map((id) => (
            <Line
              key={id}
              type="monotone"
              dataKey={id}
              name={FIELD_BY_ID[id].short}
              stroke={`var(--color-field-${id})`}
              strokeWidth={1.2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ZonesPanel({
  snap,
  selectedId,
  onSelect,
}: {
  snap: Snapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const n = snap.states.length;
  return (
    <div className="panel-scroll px-4 pb-6">
      <p className="mt-4 font-mono text-xs tracking-widest text-brass">CONVERGENCE ZONES</p>
      <h2 className="font-display text-2xl text-fg">{snap.zones.length ? snap.leader : "None at this threshold"}</h2>
      <p className="mt-1 text-sm text-muted">
        {snap.zones.length} zone{snap.zones.length === 1 ? "" : "s"} where at least two enabled fields clear the
        threshold. Utility is derived and does not vote. Discounting is {snap.redundantPairs.length ? "on for pairs that move together" : "finding no global redundancy above 0.72"}.
      </p>
      <div className="mt-3 border border-line bg-surface px-3 py-2">
        <p className="font-mono text-xs text-brass">MEXICO IS A HYPOTHESIS</p>
        {snap.mexico.map((m) => (
          <p key={m.id} className="mt-1 text-sm text-fg">
            {m.name} ranks {m.utilityRank} of {n} by utility and {m.convergenceRank} of {n} by overlap
            (U {m.utility.toFixed(2)}, overlap {m.effective.toFixed(2)}).
          </p>
        ))}
        <p className="mt-1 text-xs text-muted">No region is programmed as the terminus. The leader above is an output.</p>
      </div>
      <ul className="mt-3">
        {snap.zones.map((zone) => {
          const active = zone.nodeIds.includes(selectedId ?? "");
          return (
            <li key={zone.id}>
              <button
                type="button"
                className="chip w-full"
                aria-pressed={active}
                onClick={() => onSelect(zone.leadId)}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm text-fg">{zone.name}</span>
                  <span className="font-mono text-xs tabular-nums text-brass">{zone.meanEffective.toFixed(2)}</span>
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {zone.dominant.map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                      <i className={`swatch ${SWATCH[d.id]}`} />
                      {FIELD_BY_ID[d.id].short}
                    </span>
                  ))}
                </span>
                <span className="mt-1 block font-mono text-xs text-faint">
                  {moveLabel(zone)}
                  {zone.falseRisk ? " · redundant overlap" : ""}
                  {zone.marginal ? " · marginal" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 font-mono text-xs tracking-widest text-brass">BASIN MEANS</p>
      <ul className="mt-1">
        {snap.basinRanks.map((b) => (
          <li key={b.basin} className="flex justify-between gap-3 border-t border-line py-1 font-mono text-xs">
            <span className="text-fg">{b.label}</span>
            <span className="tabular-nums text-muted">
              {b.utility.toFixed(2)} {b.delta >= 0 ? "+" : ""}
              {b.delta.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <p className="font-mono text-xs tracking-widest text-brass">FIELD GRADIENTS</p>
        {snap.flowLines.map((line) => (
          <p key={line} className="mt-2 text-sm text-muted">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function moveLabel(zone: Zone): string {
  if (!zone.movement) return "Present encoding";
  const m = zone.movement;
  if (m.status === "new") return "New since the last step";
  if (m.status === "reappeared") return "Reappeared after a gap";
  const drift = bearingWord(m.bearing, m.kmPerDecade);
  const kind = m.status === "split" ? "Split · " : m.status === "merged" ? "Merged · " : "";
  const speed = m.kmPerDecade >= 40 ? ` · ${Math.round(m.kmPerDecade)} km/decade` : "";
  return `${kind}${drift}${speed}`;
}

export function MethodPanel({ snap }: { snap: Snapshot }) {
  const labels = DRIVER_IDS.map((id) => FIELD_BY_ID[id].short);
  return (
    <div className="panel-scroll px-4 pb-8">
      <p className="mt-4 font-mono text-xs tracking-widest text-brass">METHOD</p>
      <h2 className="font-display text-3xl text-fg">What the atlas will and will not say</h2>
      <p className="mt-2 text-sm text-muted">
        Isopleth is a scenario instrument. Baselines are qualitative encodings of published geographic patterns
        for the mid-2020s, not a calibrated Earth-system model and not a remote-sensing raster. Every path is
        conditional on the scenario, the coupling gain, and the threshold. The aim is the topology of overlap:
        where independent fields coincide, how that volume moves, and which present assets sit inside it.
      </p>
      <h3 className="mt-4 font-display text-xl">It refuses</h3>
      <ul className="mt-2 list-disc pl-4 text-sm text-muted">
        <li>Forecasts of wars, elections, or a single geographic winner.</li>
        <li>Reading a population decline as a plan, or a land-use change as a death spiral.</li>
        <li>Treating ownership that correlates with later utility as evidence of coordination.</li>
        <li>Counting population size as human capital.</li>
        <li>Letting meteorology dictate migration. Climate changes the field. It does not move people.</li>
        <li>A ranking of +230 against +240 when the gap is smaller than the noise.</li>
      </ul>
      <h3 className="mt-4 font-display text-xl">Seven fields, not seven for luck</h3>
      <ul className="mt-2 text-sm text-muted">
        {FIELDS.map((f) => (
          <li key={f.id} className="mt-2">
            <span className="text-fg">{f.label}{f.derived ? " (derived)" : ""}. </span>
            {f.about}
          </li>
        ))}
      </ul>
      <h3 className="mt-4 font-display text-xl">How a year is computed</h3>
      <p className="mt-2 text-sm text-muted">
        Time t runs from 0 to 1 across 300 years and is continuous. The slider is the interpolation; the
        horizon marks are bookmarks. Climate stress falls off from the tropics and eases, slightly, at wet
        high latitudes. Hydrocarbon depletion is offset by solar and by minerals only to the extent the
        technology and substitution knobs allow. Human-capital slopes that are already negative (aging) are
        softened where skills are deep, and positive slopes stay modest. A young population is not a skill
        stock. Infrastructure grows faster on coasts and corridors. Corporate control fades slowly if the
        resource rent collapses, and it is not the same variable as sovereignty. Institutions erode where
        they are already thin. No equation redraws a border.
      </p>
      <p className="mt-2 text-sm text-muted">
        Land utility is a weighted sum of surface climate, resources, human capital, access, institutions,
        network position, and option value already under some control. Weights move with the scenario. The
        number is always unpacked in the place panel.
      </p>
      <h3 className="mt-4 font-display text-xl">False convergence</h3>
      <p className="mt-2 text-sm text-muted">
        A field is “hot” above the threshold. Overlap is the count of hot fields. If two fields correlate
        above 0.72 across all places, the later one is discounted, because it is partly the same fact. Turn
        the discount off to see the double-counting. Removing one field in the place panel shows which
        relationships were only that field.
      </p>
      {snap.redundantPairs.length === 0 ? (
        <p className="mt-2 text-sm text-fg">No driver pair is above r = 0.72 in this cross-section.</p>
      ) : (
        <ul className="mt-2 text-sm text-fg">
          {snap.redundantPairs.map((p) => (
            <li key={`${p.a}-${p.b}`}>
              {FIELD_BY_ID[p.a].label} and {FIELD_BY_ID[p.b].label}: r = {p.r.toFixed(2)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr>
              <th className="p-1 text-left text-faint" />
              {labels.map((l) => (
                <th key={l} className="p-1 text-right font-normal text-faint">
                  {l.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DRIVER_IDS.map((row, i) => (
              <tr key={row}>
                <th className="p-1 text-left font-normal text-muted">{FIELD_BY_ID[row].short}</th>
                {DRIVER_IDS.map((col, j) => {
                  const r = snap.corr[i]?.[j] ?? 0;
                  return (
                    <td key={col} className="p-1 text-right tabular-nums text-fg">
                      {i === j ? "·" : r.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mt-4 font-display text-xl">Coupling and chaos</h3>
      <p className="mt-2 text-sm text-muted">{snap.chaos.reading}</p>
      <p className="mt-2 font-mono text-xs text-fg">
        Finite-time expansion {snap.chaos.ratio.toFixed(2)} · λ/year {snap.chaos.lambdaPerYear.toFixed(4)}
      </p>
      <p className="mt-2 text-sm text-muted">
        The third spatial axis is the asset column — surface, offshore access, or subsurface — stored on
        each place and reported on its zone. Zones are volumes: a centroid, a radius, and a column. They are
        not an invented geology mesh. Flows are drawn uphill in the chosen field. Different flows are
        different fields, and they are allowed to point different ways. None of them is a migration forecast.
      </p>
      <h3 className="mt-4 font-display text-xl">How to falsify a picture</h3>
      <ul className="mt-2 list-disc pl-4 text-sm text-muted">
        <li>Raise the threshold. A zone that vanishes was marginal.</li>
        <li>Turn redundancy discounting off. Inflation is double-counting.</li>
        <li>Remove one field. If the overlap dies, that field was load-bearing, not a chorus.</li>
        <li>Change the scenario. If the leader changes, the atlas has no fixed winner.</li>
        <li>If a “resource” hotspot has no real energy or mineral endowment, the baseline table is wrong.</li>
      </ul>
      <p className="mt-3 text-xs text-faint">
        {NODES.length} analysis places. Ownership strings are present-day categories of title and operation,
        not a parcel cadastre and not a claim about motive.
      </p>
    </div>
  );
}
