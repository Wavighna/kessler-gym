/**
 * Standalone React + TypeScript + Tailwind CSS interface prototype.
 *
 * This file is intentionally NOT imported by index.html or build.js. The live
 * Kessler demo remains the existing HTML/JavaScript implementation. To render
 * this component, a host app must provide React, a TSX compiler, Tailwind CSS
 * configured to scan this file, and a telemetry adapter for core.js. Callbacks
 * describe that integration boundary; this file does not implement a backend,
 * live satellite tracking, policy execution, or flight commands.
 */
import { useMemo, useState, type ReactNode } from "react";

export type ControllerId = "ai" | "operator" | "none";
export type RiskLevel = "elevated" | "watch" | "nominal";
export type EncounterOutcome = "pending" | "cleared" | "violation";

export interface MissionTelemetry {
  scenarioId: number;
  elapsedSeconds: number;
  durationSeconds: number;
  fuelUsed: number;
  fuelBudget: number;
  orbitDeviationMeters: number;
  highestCollisionProbability: number | null;
  clearedCount: number;
  violationCount: number;
  complete: boolean;
}

export interface Encounter {
  id: string;
  label: string;
  closestApproachSeconds: number;
  probability: number;
  predictedMissMeters: number;
  uncertaintyMeters: number;
  relativeSpeedKilometersPerSecond: number;
  outcome: EncounterOutcome;
}

export interface PolicyBenchmark {
  controller: ControllerId;
  scenarioCount: number;
  violationRate: number;
  meanDeltaV: number;
  meanOrbitDeviationMeters: number;
  meanReturn: number;
}

export interface MissionDashboardProps {
  telemetry: MissionTelemetry;
  encounters: readonly Encounter[];
  benchmarks: readonly PolicyBenchmark[];
  selectedController: ControllerId;
  running: boolean;
  /** Supply an actual globe or a static visualization from the host app. */
  orbitVisualization?: ReactNode;
  /** Controller changes must restart the same scenario in the host adapter. */
  onControllerChange: (controller: ControllerId) => void;
  onRunningChange: (running: boolean) => void;
  onReplay: () => void;
  onNewScenario: () => void;
}

const CONTROLLERS: Record<ControllerId, { label: string; description: string }> = {
  ai: { label: "AI policy", description: "Pretrained policy optimizing the combined mission objective." },
  operator: { label: "Operator rule", description: "Threshold-based avoidance followed by a return-to-slot maneuver." },
  none: { label: "No avoidance", description: "Zero maneuver inputs: the baseline for comparison." },
};

const RISK_STYLES: Record<RiskLevel, string> = {
  elevated: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  watch: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  nominal: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
};

export function collisionRisk(probability: number | null): RiskLevel {
  if (probability === null) return "nominal";
  if (probability > 1e-4) return "elevated";
  return probability > 1e-6 ? "watch" : "nominal";
}

export function formatMissionClock(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `T+${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatProbability(probability: number | null): string {
  if (probability === null) return "Not tracked";
  return probability < 1e-9 ? "< 1e-9" : probability.toExponential(1);
}

function Meter({ value, label, caution = false }: { value: number; label: string; caution?: boolean }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      className="h-1.5 overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${caution ? "bg-rose-300" : "bg-emerald-300"}`}
        style={{ width: `${percent}%` }} />
    </div>
  );
}

function Panel({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium tracking-tight text-slate-100">{title}</h2>
        {detail && <span className="text-xs text-slate-400">{detail}</span>}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, tone = "neutral" }: {
  label: string; value: string; tone?: "neutral" | "positive" | "negative";
}) {
  const color = tone === "positive" ? "text-emerald-200" : tone === "negative" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="min-w-0 border-b border-r border-slate-800 p-4 last:border-r-0 sm:p-5">
      <dt className="text-[10px] uppercase tracking-widest text-slate-400">{label}</dt>
      <dd className={`mt-3 break-words font-mono text-lg tabular-nums sm:text-xl ${color}`}>{value}</dd>
    </div>
  );
}

function EncounterList({ encounters, elapsedSeconds }: { encounters: readonly Encounter[]; elapsedSeconds: number }) {
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const visible = useMemo(() => [...encounters]
    .filter(encounter => filter === "all" || encounter.outcome === "pending")
    .sort((a, b) => a.closestApproachSeconds - b.closestApproachSeconds), [encounters, filter]);
  return (
    <Panel title="Encounter queue" detail={`${encounters.length} simulated objects`}>
      <div className="mb-4 flex gap-2" role="group" aria-label="Filter encounters">
        {(["all", "pending"] as const).map(option => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs capitalize text-slate-300 hover:border-slate-500 aria-pressed:border-emerald-300/40 aria-pressed:bg-emerald-300/10 aria-pressed:text-emerald-200">
            {option === "all" ? "All encounters" : "Upcoming"}
          </button>
        ))}
      </div>
      {visible.length === 0 ? <p className="py-8 text-sm text-slate-400">No encounters match this view.</p> : (
        <ul className="divide-y divide-slate-800">
          {visible.map(encounter => {
            const minutes = Math.ceil((encounter.closestApproachSeconds - elapsedSeconds) / 60);
            const risk = collisionRisk(encounter.probability);
            return (
              <li key={encounter.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div>
                  <h3 className="text-sm font-medium text-slate-200">{encounter.label}</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {encounter.outcome !== "pending" ? "Closest approach passed" : `${Math.max(0, minutes)} min to closest approach`}
                    {" · "}{encounter.relativeSpeedKilometersPerSecond.toFixed(1)} km/s
                  </p>
                </div>
                <div className="text-right">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] ${RISK_STYLES[risk]}`}>
                    {encounter.outcome === "pending" ? `${risk} risk` : encounter.outcome === "cleared" ? "Safely passed" : "Unsafe pass"}
                  </span>
                  <p className="mt-1.5 font-mono text-xs text-slate-400">Pc {formatProbability(encounter.probability)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function BenchmarkTable({ rows }: { rows: readonly PolicyBenchmark[] }) {
  return (
    <Panel title="Policy performance" detail="Compare evaluation sets before drawing conclusions">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <caption className="sr-only">Controller evaluation results from simulated scenarios</caption>
          <thead><tr className="border-b border-slate-700 text-[10px] uppercase tracking-wider text-slate-400">
            {["Controller", "Scenarios", "Unsafe passes", "Mean Δv", "Orbit error", "Return"].map(label => <th key={label} scope="col" className="px-3 py-3 font-medium">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map(row => (
              <tr key={row.controller} className="text-slate-300 hover:bg-slate-800/40">
                <th scope="row" className="px-3 py-4 font-medium text-slate-100">{CONTROLLERS[row.controller].label}</th>
                <td className="px-3 py-4 font-mono tabular-nums">{row.scenarioCount}</td>
                <td className="px-3 py-4 font-mono tabular-nums">{(row.violationRate * 100).toFixed(1)}%</td>
                <td className="px-3 py-4 font-mono tabular-nums">{row.meanDeltaV.toFixed(2)} m/s</td>
                <td className="px-3 py-4 font-mono tabular-nums">{Math.round(row.meanOrbitDeviationMeters)} m</td>
                <td className="px-3 py-4 font-mono tabular-nums">{row.meanReturn.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-5 max-w-3xl text-xs leading-relaxed text-slate-400">
        Lower unsafe-pass rates, fuel use and orbit error are better. Higher return is better.
        The combined objective balances these quantities; it does not imply that the controller with the highest return has the fewest violations.
      </p>
    </Panel>
  );
}

export default function MissionDashboard(props: MissionDashboardProps) {
  const { telemetry, selectedController, running } = props;
  const risk = collisionRisk(telemetry.highestCollisionProbability);
  const remainingFuel = Math.max(0, telemetry.fuelBudget - telemetry.fuelUsed);
  const fuelPercent = telemetry.fuelBudget > 0 ? remainingFuel / telemetry.fuelBudget * 100 : 0;
  const missionPercent = telemetry.durationSeconds > 0 ? telemetry.elapsedSeconds / telemetry.durationSeconds * 100 : 0;
  const next = useMemo(() => props.encounters
    .filter(encounter => encounter.outcome === "pending" && encounter.closestApproachSeconds > telemetry.elapsedSeconds)
    .reduce<Encounter | undefined>((nearest, encounter) => !nearest || encounter.closestApproachSeconds < nearest.closestApproachSeconds ? encounter : nearest, undefined),
  [props.encounters, telemetry.elapsedSeconds]);
  const status = telemetry.complete ? "Scenario complete" : risk === "elevated" ? "Elevated collision risk" : next ? "Close approach tracked" : "Monitoring your orbit";

  return (
    <main className="min-h-screen bg-[#0b1014] px-4 pb-10 text-slate-200 antialiased sm:px-8 lg:px-12 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-emerald-300">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex items-center justify-between border-b border-slate-800 py-6">
          <a href="#mission-overview" className="flex items-center gap-3 text-xl font-semibold tracking-[0.16em]">
            <svg viewBox="0 0 32 32" className="h-8 w-8 text-emerald-200" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="16" cy="16" r="11" /><ellipse cx="16" cy="16" rx="16" ry="5" transform="rotate(-35 16 16)" /><circle cx="27" cy="9" r="2" fill="currentColor" />
            </svg>KESSLER
          </a>
          <span className="rounded-full border border-amber-200/20 bg-amber-200/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-amber-100">UI prototype</span>
        </header>

        <section id="mission-overview" className="flex flex-wrap items-end justify-between gap-6 py-3">
          <div><p className="mb-3 text-[10px] uppercase tracking-[0.2em] text-emerald-200">Orbital intelligence / Mission control</p>
            <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">A clearer path through orbit.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">Explore close approaches, compare controllers and understand the cost of every maneuver.</p>
          </div>
          <span role="status" className={`rounded-lg border px-4 py-3 text-xs ${RISK_STYLES[risk]}`}>{status}</span>
        </section>

        <Panel title="Flight controller" detail={`Scenario #${telemetry.scenarioId}`}>
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Select controller" className="flex flex-wrap gap-1 rounded-xl border border-slate-700 bg-slate-950/40 p-1">
              {(Object.keys(CONTROLLERS) as ControllerId[]).map(id => (
                <button key={id} type="button" aria-pressed={selectedController === id} onClick={() => props.onControllerChange(id)}
                  className="rounded-lg px-4 py-2.5 text-xs text-slate-400 transition-colors hover:text-slate-100 aria-pressed:bg-emerald-300/15 aria-pressed:text-emerald-200">{CONTROLLERS[id].label}</button>
              ))}
            </div>
            <button type="button" disabled={telemetry.complete} onClick={() => props.onRunningChange(!running)} className="rounded-lg bg-emerald-200 px-4 py-2.5 text-xs font-semibold text-emerald-950 disabled:opacity-40">{running ? "Pause" : "Play"}</button>
            <button type="button" onClick={props.onReplay} className="rounded-lg border border-slate-700 px-4 py-2.5 text-xs hover:bg-slate-800">Replay</button>
            <button type="button" onClick={props.onNewScenario} className="rounded-lg border border-slate-700 px-4 py-2.5 text-xs hover:bg-slate-800">New scenario</button>
          </div>
          <p className="mt-4 text-xs text-slate-400">{CONTROLLERS[selectedController].description} Switch controllers to restart the same scenario.</p>
        </Panel>

        <dl className="grid overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Mission clock" value={formatMissionClock(telemetry.elapsedSeconds)} />
          <Metric label="Fuel spent · Δv" value={`${telemetry.fuelUsed.toFixed(2)} m/s`} />
          <Metric label="Orbit deviation" value={`${Math.round(telemetry.orbitDeviationMeters)} m`} />
          <Metric label="Collision probability" value={formatProbability(telemetry.highestCollisionProbability)} tone={risk === "elevated" ? "negative" : "neutral"} />
          <Metric label="Safely passed" value={String(telemetry.clearedCount)} tone="positive" />
          <Metric label="Unsafe passes" value={String(telemetry.violationCount)} tone={telemetry.violationCount ? "negative" : "neutral"} />
        </dl>

        <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Panel title="Orbital overview" detail="Simulated LEO environment">
            {props.orbitVisualization ?? (
              <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/50 px-8 text-center">
                <span className="text-4xl text-emerald-200" aria-hidden="true">◉</span>
                <p className="text-sm text-slate-300">Orbit visualization slot</p>
                <p className="max-w-sm text-xs leading-6 text-slate-500">Supply the existing globe renderer through the orbitVisualization prop. This prototype does not render a live orbit.</p>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between gap-4 text-[10px] uppercase tracking-wider text-slate-400"><span>LEO · 550 km · 53°</span><span>Simulation only</span></div>
          </Panel>
          <Panel title="Encounter assessment">
            <h3 className="text-2xl font-medium tracking-tight">{status}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">{telemetry.complete ? "Review the outcome, then replay the same mission with another controller." : next ? `${next.label} is the next tracked object. Watch how its estimated pass changes as uncertainty decreases.` : "No upcoming detected encounter. Monitoring the satellite's orbit."}</p>
            <dl className="my-6 grid grid-cols-2 gap-6 border-y border-slate-800 py-5 text-xs">
              <div><dt className="text-slate-400">Closest approach</dt><dd className="mt-2 font-mono text-slate-100">{next ? `${Math.ceil((next.closestApproachSeconds - telemetry.elapsedSeconds) / 60)} min` : "—"}</dd></div>
              <div><dt className="text-slate-400">Predicted miss</dt><dd className="mt-2 font-mono text-slate-100">{next ? `${Math.round(next.predictedMissMeters)} m` : "—"}</dd></div>
              <div><dt className="text-slate-400">Tracking uncertainty · 1σ</dt><dd className="mt-2 font-mono text-slate-100">{next ? `${Math.round(next.uncertaintyMeters)} m` : "—"}</dd></div>
              <div><dt className="text-slate-400">Fuel remaining</dt><dd className="mt-2 font-mono text-slate-100">{remainingFuel.toFixed(2)} m/s</dd></div>
            </dl>
            <div className="space-y-5"><Meter value={fuelPercent} label="Fuel remaining" caution={fuelPercent < 20} /><div><p className="mb-2 text-xs text-slate-400">Mission progress</p><Meter value={missionPercent} label="Mission progress" /></div></div>
          </Panel>
        </div>

        <EncounterList encounters={props.encounters} elapsedSeconds={telemetry.elapsedSeconds} />
        <BenchmarkTable rows={props.benchmarks} />
        <details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <summary className="cursor-pointer text-sm font-medium text-slate-100">Integration notes</summary>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">Connect core.js telemetry through the typed props above. The host owns the simulation clock, scenario seed, worker pool, policy weights and globe lifecycle. This component only renders supplied data and forwards user actions; no operational controls or network services are implemented here.</p>
        </details>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-slate-800 pt-5 text-xs text-slate-500"><span>Standalone interface prototype · Not connected to the live demo</span><a className="text-slate-400 underline-offset-4 hover:underline" href="https://github.com/Wavighna/kessler-gym">Project source</a></footer>
      </div>
    </main>
  );
}
