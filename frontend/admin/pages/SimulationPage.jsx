import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ErrorBoundary from '@shared/components/ErrorBoundary';
import { api } from '@shared/api/client';
import { useSimulation } from '@shared/hooks/useSimulation';
import { formatIntersectionName } from '@shared/utils/intersections';
import SimulationCanvas3D from '../components/SimulationCanvas3D';

function formatTick(tick) {
  return String(tick || 0).padStart(4, '0');
}

function formatSeconds(value) {
  return `${(value || 0).toFixed(1)}s`;
}

function formatWaitComparison(state) {
  if (!state) return 'Run fixed first to capture a baseline';

  const totalWait = `Total wait: ${formatSeconds(state.current_total_wait_time || 0)} across ${state.vehicles_served_this_run || 0} vehicles`;
  if (state.baseline_avg_wait_time == null) {
    return `${totalWait} | Run fixed first to capture a baseline`;
  }

  const adjustedCurrent = formatSeconds(state.current_sample_adjusted_wait_time || 0);
  const adjustedBaseline = formatSeconds(state.baseline_sample_adjusted_wait_time || state.baseline_avg_wait_time || 0);
  return `${totalWait} | Current vs fixed: ${adjustedCurrent} vs ${adjustedBaseline}`;
}

function formatPhaseLabel(value) {
  return String(value || 'red').replace(/^./, (char) => char.toUpperCase());
}

function formatIntersectionList(ids = [], intersections = []) {
  if (!ids.length) return 'No active spillback';
  return ids
    .map((id) => {
      const match = intersections.find((intersection) => intersection.id === id);
      return formatIntersectionName(id, match?.name);
    })
    .join(' | ');
}

function formatSummaryTone(summary) {
  const normalized = String(summary || '').toLowerCase();
  if (normalized.includes('heavy')) return 'text-rose-700';
  if (normalized.includes('moderate')) return 'text-amber-700';
  return 'text-emerald-700';
}

function liveApproachCount(approach, presence = 0) {
  return Math.max(Number(approach?.queue_length || 0), Math.round(Number(presence || 0)));
}

function DetectionPanel({ detection }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">Vehicle Detection</span>
        <span className="text-sm text-slate-500">{open ? 'v' : '>'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-5 py-4">
          {detection.isProcessing && (
            <div className="mt-4">
              <progress
                max="100"
                value={Math.max(6, (detection.jobProgress || 0) * 100)}
                className="h-3 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-rwendo-accent"
              />
              <div className="mt-2 text-sm text-slate-600">
                Processing... frame {detection.jobFrame} of {detection.jobTotal || '?'}
              </div>
            </div>
          )}

          {detection.resultUrl && detection.jobComplete ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-black">
                <video
                  key={detection.resultUrl}
                  src={api.fileUrl(detection.resultUrl)}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                  className="aspect-video w-full"
                />
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <div className="font-semibold text-slate-900">
                  {detection.hasDefaultVideo ? 'Default Simulation Video' : 'Latest Annotated Result'}
                </div>
                <div className="mt-3">
                  Cars: {detection.counts.car} | Trucks: {detection.counts.truck} | Buses: {detection.counts.bus} |
                  Motos: {detection.counts.motorcycle}
                </div>
                <a
                  href={api.fileUrl(detection.resultUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-block font-semibold text-rwendo-accent hover:underline"
                >
                  Open full annotated video
                </a>
                <button
                  type="button"
                  onClick={detection.reset}
                  className="mt-3 block text-xs font-semibold text-slate-500 hover:text-rwendo-accent"
                >
                  Reset detection state
                </button>
                <div className="mt-4 text-xs text-slate-500">
                  {detection.hasDefaultVideo
                    ? 'The bundled pre-annotated clip is loaded automatically for demo playback. Use the Detection page only when you want to process a different video.'
                    : 'Upload and process videos from the Detection page. This panel loops the latest annotated result during the simulation demo.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500">
              No annotated video loaded yet. Run detection from the Detection page, then use this panel to preview the latest annotated result on loop.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrafficBadge({ summary, congestion }) {
  const normalized = String(summary || '').toLowerCase();
  const label = summary || 'Normal traffic';
  const tone = normalized.includes('heavy')
    ? 'bg-rose-100 text-rose-700'
    : normalized.includes('moderate')
      ? 'bg-amber-100 text-amber-700'
      : 'bg-emerald-100 text-emerald-700';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      Traffic: {label}
      {congestion != null && (
        <span className="ml-1 rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-bold text-slate-700">
          {Number(congestion || 0).toFixed(1)}
        </span>
      )}
    </span>
  );
}

function JunctionMetricsPanel({
  intersections,
  junctionMetrics,
  currentComparison,
  baselineComparison,
  baselineRunId,
  baselineScenario,
  baselineDuration,
  currentScenario,
  currentMode,
  baselineAvailable,
  selectedIntersectionId,
  onSelect,
  onInjectEmergency,
}) {
  if (!intersections.length) {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Junction Metrics</div>
        <div className="mt-4 rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
          Waiting for the network to come online.
        </div>
      </div>
    );
  }

  const selected = intersections.find((intersection) => intersection.id === selectedIntersectionId) || intersections[0];
  const metrics = selected ? junctionMetrics?.[selected.id] : null;
  const currentCmp = selected ? currentComparison?.[selected.id] : null;
  const baselineCmp = selected ? baselineComparison?.[selected.id] : null;
  const totalQueue = selected
    ? selected.approaches.reduce((sum, approach) => {
        const isNS = approach.direction === 'NS';
        const livePresence = isNS ? metrics?.ns_presence : metrics?.ew_presence;
        return sum + liveApproachCount(approach, livePresence);
      }, 0)
    : 0;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Junction Metrics</div>
          <div className="mt-1 text-xs text-slate-500">
            Switch junction to inspect its live numbers. {baselineAvailable && baselineRunId ? `Baseline: Run ${baselineRunId} (${(baselineScenario || 'unknown').replace('_', ' ')}, ${baselineDuration ? formatElapsedTick(baselineDuration) : ''}).` : 'Run fixed first to capture a baseline.'}
            {baselineAvailable && baselineScenario && currentScenario && baselineScenario !== currentScenario && (
              <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Scenario differs</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onInjectEmergency}
          className="self-start rounded-full bg-rose-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-600 lg:self-auto"
        >
          🚑 Inject Emergency Vehicle
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {intersections.map((intersection) => {
          const active = intersection.id === selected?.id;
          return (
            <button
              key={intersection.id}
              type="button"
              onClick={() => onSelect(intersection.id)}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {formatIntersectionName(intersection.id, intersection.name)}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xl font-bold text-slate-900">
                  {formatIntersectionName(selected.id, selected.name)}
                </div>
                <div className="text-xs text-slate-500">Mode: {String(selected.mode || 'fixed').toUpperCase()} · Emergency: {selected.emergency_state}</div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                  selected.spillback_active ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {selected.spillback_active ? 'Spillback' : 'Stable'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-[16px] bg-slate-50 px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Vehicles</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{totalQueue.toFixed(0)}</div>
              </div>
              <div className="rounded-[16px] bg-slate-50 px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">NS presence</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{Number(metrics?.ns_presence || 0).toFixed(1)}</div>
              </div>
              <div className="rounded-[16px] bg-slate-50 px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">EW presence</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{Number(metrics?.ew_presence || 0).toFixed(1)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {selected.approaches.map((approach) => {
                const isNS = approach.direction === 'NS';
                const livePresence = isNS ? metrics?.ns_presence : metrics?.ew_presence;
                const approachCount = liveApproachCount(approach, livePresence);
                return (
                  <div key={approach.direction} className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        {isNS ? 'North-South' : 'East-West'}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          approach.phase === 'green'
                            ? 'bg-emerald-100 text-emerald-700'
                            : approach.phase === 'amber'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {formatPhaseLabel(approach.phase)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline gap-3">
                      <span className="text-lg font-bold text-slate-900">{approachCount}</span>
                      <span className="text-[11px] text-slate-500">veh · {approach.countdown}s left</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="font-semibold uppercase tracking-[0.14em] text-slate-500">Fixed Baseline vs {currentMode === 'adaptive' ? 'Adaptive' : 'Current'}</div>
              {!baselineCmp && <span className="text-slate-400">Not captured yet</span>}
            </div>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2 pr-3 font-semibold">Metric</th>
                  <th className="pb-2 pr-3 font-semibold">Baseline</th>
                  <th className="pb-2 font-semibold">{currentMode === 'adaptive' ? 'Adaptive' : 'Current'}</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                <tr className="border-t border-slate-200">
                  <td className="py-2 pr-3 font-semibold">Avg wait</td>
                  <td className="py-2 pr-3">{baselineCmp ? `${Number(baselineCmp.avg_wait_time || 0).toFixed(1)}s` : '—'}</td>
                  <td className="py-2">{`${Number(currentCmp?.avg_wait_time || 0).toFixed(1)}s`}</td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-semibold">Vehicle count</td>
                  <td className="py-2 pr-3">{baselineCmp ? Number(baselineCmp.vehicle_count || 0).toFixed(0) : '—'}</td>
                  <td className="py-2">{Number(currentCmp?.vehicle_count || 0).toFixed(0)}</td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-semibold">Throughput</td>
                  <td className="py-2 pr-3">{baselineCmp ? `${Number(baselineCmp.throughput_vpm || 0).toFixed(1)} veh/min` : '—'}</td>
                  <td className="py-2">{`${Number(currentCmp?.throughput_vpm || 0).toFixed(1)} veh/min`}</td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-semibold">Spillback events</td>
                  <td className="py-2 pr-3">{baselineCmp ? Number(baselineCmp.spillback_events || 0).toFixed(0) : '—'}</td>
                  <td className="py-2">{Number(currentCmp?.spillback_events || 0).toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EventLogPanel({ alerts }) {
  const entries = Array.isArray(alerts) ? alerts.slice(-50).reverse() : [];

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Event Log</div>
        <div className="text-xs text-slate-500">{entries.length} recent event{entries.length === 1 ? '' : 's'}</div>
      </div>
      {entries.length === 0 ? (
        <div className="mt-4 rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
          No events yet. Spillback, congestion, and emergency activity will appear here as the simulation runs.
        </div>
      ) : (
        <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
          {entries.map((message, index) => {
            const lower = String(message).toLowerCase();
            const tone = lower.includes('emergency') || lower.includes('preemption')
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : lower.includes('spillback')
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-50 text-slate-700';
            return (
              <li key={`${index}-${message}`} className={`rounded-[14px] border px-4 py-2 text-sm ${tone}`}>
                {message}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function isCompletedRun(run) {
  return Boolean(run?.ended_at) && Number(run?.duration_ticks || 0) > 0;
}

function formatNumber(value, digits = 1) {
  return Number(value || 0).toFixed(digits);
}

function RunHistoryTable({ title, runs, accent }) {
  if (!runs.length) {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className={`text-sm font-semibold uppercase tracking-[0.16em] ${accent}`}>{title}</div>
        <div className="mt-4 rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
          No completed runs yet. Start a {title.toLowerCase()} and let it finish to record a row here.
        </div>
      </div>
    );
  }

  const totals = runs.reduce(
    (acc, run) => {
      acc.avgWait += Number(run.avg_wait_time || 0);
      acc.throughput += Number(run.throughput_per_min || 0);
      acc.queue += Number(run.avg_queue_length || 0);
      acc.preemptions += Number(run.preemption_events || 0);
      acc.spillback += Number(run.spillback_events || 0);
      return acc;
    },
    { avgWait: 0, throughput: 0, queue: 0, preemptions: 0, spillback: 0 },
  );
  const count = runs.length;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={`text-sm font-semibold uppercase tracking-[0.16em] ${accent}`}>{title}</div>
        <div className="text-xs text-slate-500">{count} completed run{count === 1 ? '' : 's'}</div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-4 font-semibold">Sim No.</th>
              <th className="py-2 pr-4 font-semibold">Avg wait</th>
              <th className="py-2 pr-4 font-semibold">Throughput</th>
              <th className="py-2 pr-4 font-semibold">Emergency Preemption</th>
              <th className="py-2 pr-4 font-semibold">Queue length</th>
              <th className="py-2 font-semibold">Spillback</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {runs.map((run, index) => (
              <tr key={run.run_id || index} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-semibold">{index + 1}</td>
                <td className="py-2 pr-4">{formatNumber(run.avg_wait_time)}s</td>
                <td className="py-2 pr-4">{formatNumber(run.throughput_per_min)} veh/min</td>
                <td className="py-2 pr-4">{Number(run.preemption_events || 0).toFixed(0)}</td>
                <td className="py-2 pr-4">{formatNumber(run.avg_queue_length)}</td>
                <td className="py-2">{Number(run.spillback_events || 0).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50 text-slate-900">
              <td className="py-2 pr-4 font-bold">Total / Avg</td>
              <td className="py-2 pr-4 font-semibold">{formatNumber(totals.avgWait / count)}s avg</td>
              <td className="py-2 pr-4 font-semibold">{formatNumber(totals.throughput / count)} veh/min avg</td>
              <td className="py-2 pr-4 font-semibold">{totals.preemptions.toFixed(0)} total</td>
              <td className="py-2 pr-4 font-semibold">{formatNumber(totals.queue / count)} avg</td>
              <td className="py-2 font-semibold">{totals.spillback.toFixed(0)} total</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function StatCard({ title, value, detail, accent = 'text-slate-900', onClick }) {
  const interactive = typeof onClick === 'function';
  const Wrapper = interactive ? 'button' : 'div';
  const wrapperProps = interactive
    ? {
        onClick,
        type: 'button',
        className:
          'w-full text-left rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-rwendo-accent hover:shadow-md cursor-pointer',
      }
    : { className: 'rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm' };

  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div>
        {interactive && <span className="text-xs text-rwendo-accent">View →</span>}
      </div>
      <div className={`mt-3 text-2xl font-bold ${accent}`}>{value}</div>
      {detail && <div className="mt-2 text-sm text-slate-500">{detail}</div>}
    </Wrapper>
  );
}

function describeAgentDecision(intersection, metrics) {
  if (!intersection) return 'Idle';
  if (intersection.emergency_state && intersection.emergency_state !== 'idle') {
    return `Emergency: ${intersection.emergency_state}`;
  }
  if (intersection.spillback_active) {
    return 'Holding green to drain spillback';
  }
  if (String(intersection.mode).toLowerCase() === 'fixed') {
    return 'Fixed timing — no adaptive decision';
  }
  const nsPresence = Number(metrics?.ns_presence || 0);
  const ewPresence = Number(metrics?.ew_presence || 0);
  const greenApproach = (intersection.approaches || []).find((approach) => approach.phase === 'green');
  if (!greenApproach) return 'Transitioning between phases';
  const dominant = nsPresence > ewPresence ? 'NS' : ewPresence > nsPresence ? 'EW' : null;
  if (!dominant) return `Green on ${greenApproach.direction} — balanced demand`;
  if (dominant === greenApproach.direction) {
    return `Green on ${greenApproach.direction} — favoring heavier demand (${dominant} presence ${Math.max(nsPresence, ewPresence).toFixed(1)})`;
  }
  return `Green on ${greenApproach.direction} — preparing to switch (${dominant} demand rising)`;
}

function AgentStatusPanel({ intersections, junctionMetrics, networkMode }) {
  if (!intersections?.length) {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Agent Activity</div>
        <div className="mt-4 rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
          Waiting for the network to come online.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Agent Activity</div>
          <div className="text-xs text-slate-500">Live decision per controller — what each "robot" is doing this tick.</div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Network mode: {networkMode}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {intersections.map((intersection) => {
          const metrics = junctionMetrics?.[intersection.id];
          const decision = describeAgentDecision(intersection, metrics);
          const greenApproach = (intersection.approaches || []).find((approach) => approach.phase === 'green');
          const isEmergency = intersection.emergency_state && intersection.emergency_state !== 'idle';
          const tone = isEmergency
            ? 'border-rose-300 bg-rose-50'
            : intersection.spillback_active
              ? 'border-amber-300 bg-amber-50'
              : 'border-slate-200 bg-slate-50';
          return (
            <div key={intersection.id} className={`rounded-[18px] border px-4 py-3 ${tone}`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">
                  {formatIntersectionName(intersection.id, intersection.name)}
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">
                  {String(intersection.mode || 'fixed').toUpperCase()}
                </span>
              </div>
              <div className="mt-2 text-sm text-slate-700">{decision}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
                {greenApproach && (
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
                    Green: {greenApproach.direction} · {greenApproach.countdown}s
                  </span>
                )}
                <span className="rounded-full bg-white px-2 py-1 text-slate-700">
                  NS {Number(metrics?.ns_presence || 0).toFixed(1)} / EW {Number(metrics?.ew_presence || 0).toFixed(1)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricsPopup({ open, state, currentSeries, onClose }) {
  if (!open) return null;

  const avgWait = Number(state?.current_avg_wait_time || 0);
  const totalQueue = (state?.intersections || []).reduce(
    (sum, intersection) => sum + intersection.approaches.reduce((s, approach) => s + Number(approach.queue_length || 0), 0),
    0,
  );
  const longestQueueIntersection = (state?.intersections || []).reduce((best, intersection) => {
    const queue = intersection.approaches.reduce((s, approach) => s + Number(approach.queue_length || 0), 0);
    if (!best || queue > best.queue) return { intersection, queue };
    return best;
  }, null);

  const trimmed = (currentSeries || []).slice(-30);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rwendo-accent">Live Metrics</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">Average Wait & Queue Length</div>
            <div className="mt-1 text-sm text-slate-500">Snapshot of the current run, refreshing every tick.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Average vehicle wait</div>
              <div className="mt-2 text-3xl font-bold text-emerald-700">{avgWait.toFixed(1)}s</div>
              <div className="mt-2 text-sm text-slate-500">
                Total wait this run: {Number(state?.current_total_wait_time || 0).toFixed(0)}s across {Number(state?.vehicles_served_this_run || 0)} vehicles
              </div>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Queue length (sum across junctions)</div>
              <div className="mt-2 text-3xl font-bold text-slate-900">{totalQueue.toFixed(0)} vehicles</div>
              <div className="mt-2 text-sm text-slate-500">
                {longestQueueIntersection
                  ? `Longest: ${formatIntersectionName(longestQueueIntersection.intersection.id, longestQueueIntersection.intersection.name)} (${longestQueueIntersection.queue.toFixed(0)})`
                  : 'No queue data yet.'}
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Wait time over time</div>
            <div className="mt-4 h-56">
              <ResponsiveContainer>
                <LineChart data={trimmed}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="elapsed_s"
                    tickFormatter={(value) => `${Math.round(Number(value || 0))}s`}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tickFormatter={(value) => `${Number(value || 0).toFixed(0)}s`} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => `${Number(value || 0).toFixed(1)}s`} />
                  <Line type="monotone" dataKey="wait" stroke="#f97316" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatElapsedTick(value) {
  const seconds = Number(value || 0);
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return remainder === 0 ? `${minutes}m` : `${minutes}m${remainder}s`;
  }
  return `${Math.round(seconds)}s`;
}

function ComparisonChart({
  title,
  data,
  currentLabel,
  baselineLabel,
  currentKey,
  baselineKey,
  formatter,
  currentStroke = '#f97316',
  domainMax,
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="elapsed"
              type="number"
              domain={[0, domainMax || 'dataMax']}
              tickFormatter={formatElapsedTick}
              tick={{ fontSize: 12 }}
              label={{ value: 'Simulated time', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#64748b' }}
            />
            <YAxis tickFormatter={formatter} tick={{ fontSize: 12 }} />
            <Tooltip
              labelFormatter={(value) => formatElapsedTick(value)}
              formatter={(value) => formatter(value)}
            />
            <Legend />
            <Line type="monotone" dataKey={baselineKey} name={baselineLabel} stroke="#94a3b8" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey={currentKey} name={currentLabel} stroke={currentStroke} strokeWidth={3} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


export default function SimulationPage({ user, detection }) {
  const { state, sendCommand, sendEmergencySpawnRandom, connected } = useSimulation();
  const [boundaryKey, setBoundaryKey] = useState(0);
  const [toast, setToast] = useState('');
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [selectedIntersectionId, setSelectedIntersectionId] = useState(null);
  const [health, setHealth] = useState({ backend: 'checking', detection: 'checking' });
  const [runHistory, setRunHistory] = useState([]);
  const prevStartedRef = useRef(false);

  const refetchRunHistory = useCallback(async () => {
    try {
      const data = await api.get('/api/analytics/runs');
      if (Array.isArray(data)) {
        setRunHistory(data);
      }
    } catch {
      // surface nothing — empty state already handles missing history
    }
  }, []);

  useEffect(() => {
    refetchRunHistory();
  }, [refetchRunHistory]);

  // Refetch when a run transitions from running -> stopped (run completed).
  useEffect(() => {
    const wasStarted = prevStartedRef.current;
    const isStarted = Boolean(state?.started);
    if (wasStarted && !isStarted) {
      refetchRunHistory();
    }
    prevStartedRef.current = isStarted;
  }, [state?.started, refetchRunHistory]);

  const completedRuns = useMemo(
    () =>
      runHistory
        .filter(isCompletedRun)
        .slice()
        .sort((a, b) => {
          const tA = new Date(a.ran_at || a.ended_at || a.started_at || 0).getTime();
          const tB = new Date(b.ran_at || b.ended_at || b.started_at || 0).getTime();
          return tA - tB;
        }),
    [runHistory],
  );

  const fixedRuns = useMemo(() => completedRuns.filter((run) => run.mode === 'fixed'), [completedRuns]);
  const adaptiveRuns = useMemo(() => completedRuns.filter((run) => run.mode === 'adaptive'), [completedRuns]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    const pollHealth = async () => {
      try {
        const backend = await api.get('/health');
        const detectionInfo = await api.get('/api/detection/default');
        if (!cancelled) {
          setHealth({
            backend: backend.status === 'ok' ? 'ready' : 'degraded',
            detection: detectionInfo?.result_url ? 'ready' : 'missing',
          });
        }
      } catch {
        if (!cancelled) {
          setHealth({ backend: 'offline', detection: 'offline' });
        }
      }
    };
    pollHealth();
    const interval = window.setInterval(pollHealth, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!state?.intersections?.length) return;
    if (selectedIntersectionId && state.intersections.some((intersection) => intersection.id === selectedIntersectionId)) {
      return;
    }
    setSelectedIntersectionId(state.intersections[0].id);
  }, [selectedIntersectionId, state]);

  const networkMode = state?.current_mode || 'fixed';
  const currentLabel = networkMode === 'adaptive' ? 'Adaptive run' : 'Fixed run';
  const baselineSeries = state?.baseline_timeseries || [];
  const currentSeries = state?.current_timeseries || [];
  const baselineAvailable = baselineSeries.length > 0;
  const overlayLabel = baselineAvailable ? 'Fixed baseline' : 'No baseline yet';
  const runStatus = !state?.started ? 'READY' : state?.running ? 'LIVE' : 'PAUSED';
  const currentStroke = networkMode === 'adaptive' ? '#22c55e' : '#0f172a';

  // Merge current + baseline samples on a shared `elapsed` (simulated seconds)
  // axis. Each side may have different lengths; we union the timestamps so
  // Recharts draws both lines on the same x-domain. `connectNulls` on the line
  // takes care of holes when one side ends earlier than the other.
  const comparisonSeries = useMemo(() => {
    const byElapsed = new Map();
    const ensure = (elapsed) => {
      const key = Number(elapsed).toFixed(1);
      if (!byElapsed.has(key)) {
        byElapsed.set(key, {
          elapsed: Number(key),
          currentWait: null,
          currentThroughput: null,
          currentCongestion: null,
          currentGreenWave: null,
          baselineWait: null,
          baselineThroughput: null,
          baselineCongestion: null,
          baselineGreenWave: null,
        });
      }
      return byElapsed.get(key);
    };
    for (const point of currentSeries) {
      const row = ensure(point.elapsed_s);
      row.currentWait = point.wait;
      row.currentThroughput = point.throughput;
      row.currentCongestion = point.congestion;
      row.currentGreenWave = point.green_wave;
    }
    for (const point of baselineSeries) {
      const row = ensure(point.elapsed_s);
      row.baselineWait = point.wait;
      row.baselineThroughput = point.throughput;
      row.baselineCongestion = point.congestion;
      row.baselineGreenWave = point.green_wave;
    }
    return Array.from(byElapsed.values()).sort((a, b) => a.elapsed - b.elapsed);
  }, [currentSeries, baselineSeries]);

  const chartDomainMax = useMemo(() => {
    const candidates = [
      state?.elapsed_seconds || 0,
      state?.baseline_duration_s || 0,
      currentSeries[currentSeries.length - 1]?.elapsed_s || 0,
      baselineSeries[baselineSeries.length - 1]?.elapsed_s || 0,
    ];
    const max = Math.max(...candidates);
    return max > 0 ? Math.ceil(max) : 'dataMax';
  }, [state?.elapsed_seconds, state?.baseline_duration_s, currentSeries, baselineSeries]);

  const spillbackDetail = formatIntersectionList(state?.spillback_locations || [], state?.intersections || []);
  const summaryTone = formatSummaryTone(state?.network_summary);

  function setNetworkMode(mode) {
    sendCommand('set_network_mode', { mode });
    setBoundaryKey((value) => value + 1);
    setToast(`Mode set to ${mode === 'adaptive' ? 'adaptive' : 'fixed time'}. Press Start Run to begin.`);
  }

  function startRun() {
    sendCommand('start_run');
    setToast(`Started ${networkMode === 'adaptive' ? 'adaptive' : 'fixed time'} run`);
  }

  function resetRun() {
    sendCommand('reset');
    setBoundaryKey((value) => value + 1);
    setToast('Run reset. Press Start Run when you are ready.');
  }

  function stopRun() {
    sendCommand('stop_run');
    setBoundaryKey((value) => value + 1);
    setToast('Run stopped and saved to history.');
  }

  function injectEmergency() {
    sendEmergencySpawnRandom();
    setToast('Emergency vehicle dispatched to a random junction.');
  }

  function HealthBadge({ label, value }) {
    const tone =
      value === 'ready'
        ? 'bg-emerald-100 text-emerald-700'
        : value === 'checking'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-rose-100 text-rose-700';
    return (
      <div className="rounded-full bg-white px-3 py-2 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
        <span className={`ml-2 rounded-full px-2 py-1 text-xs font-semibold ${tone}`}>{value}</span>
      </div>
    );
  }

  function scenarioButton(value, label) {
    const active = state?.scenario === value;
    return (
      <button
        key={value}
        onClick={() => sendCommand('set_scenario', { scenario: value })}
        className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition ${
          active ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-6 py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-rwendo-accent/10 px-4 py-2 text-lg font-bold text-rwendo-accent">
                Rwendo
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">Simulation</div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        runStatus === 'LIVE'
                          ? 'bg-signal-green'
                          : runStatus === 'PAUSED'
                            ? 'bg-signal-amber'
                            : 'bg-slate-400'
                      }`}
                    />
                    {runStatus}
                  </span>
                  <span>Tick: {formatTick(state?.tick)}</span>
                  <span className="uppercase">Mode: {networkMode}</span>
                  <TrafficBadge summary={state?.network_summary} congestion={state?.current_avg_congestion} />
                </div>
              </div>
            </div>

            <div className="rounded-[24px] bg-slate-100 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Run Controls</div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  onClick={() => setNetworkMode('fixed')}
                  className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
                    networkMode === 'fixed' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  }`}
                >
                  FIXED TIME
                </button>
                <button
                  onClick={() => setNetworkMode('adaptive')}
                  className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
                    networkMode === 'adaptive' ? 'bg-signal-green text-slate-900' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  }`}
                >
                  ADAPTIVE
                </button>
                {!state?.started ? (
                  <button
                    onClick={startRun}
                    className="rounded-full bg-rwendo-accent px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    Start Run
                  </button>
                ) : state?.running ? (
                  <button
                    onClick={() => sendCommand('pause')}
                    className="rounded-full bg-signal-amber px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={() => sendCommand('resume')}
                    className="rounded-full bg-signal-green px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                  >
                    Resume
                  </button>
                )}
                {state?.started && (
                  <button
                    onClick={stopRun}
                    className="rounded-full bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-600"
                  >
                    Stop Simulation
                  </button>
                )}
                <button
                  onClick={resetRun}
                  className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Reset
                </button>
              </div>
              <div className="mt-3 text-sm text-slate-500">
                {!state?.started
                  ? 'The network is ready but idle. Start Run begins vehicle generation from the six off-canvas entry points.'
                  : state?.running
                    ? 'Vehicles are moving inside the SUMO-backed network and respond to live signal timing, spacing, and downstream congestion.'
                    : 'The run is paused. Resume continues the same run; Reset clears the network and returns to ready state.'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {scenarioButton('off_peak', 'Off Peak')}
                {scenarioButton('peak', 'Peak')}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <HealthBadge label="Socket" value={connected ? 'ready' : 'offline'} />
                <HealthBadge label="Backend" value={health.backend} />
                <HealthBadge label="Detection" value={health.detection} />
              </div>
            </div>
          </div>
        </div>

        <DetectionPanel detection={detection} />

        <div className="rounded-[30px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex justify-center">
            <ErrorBoundary resetKey={boundaryKey}>
              <SimulationCanvas3D state={state} resetToken={boundaryKey} />
            </ErrorBoundary>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <StatCard
            title="Current Wait"
            value={formatSeconds(state?.current_avg_wait_time || 0)}
            detail={formatWaitComparison(state)}
            accent="text-emerald-700"
            onClick={() => setMetricsOpen(true)}
          />
          <StatCard
            title="Throughput"
            value={`${(state?.current_throughput_vpm || 0).toFixed(1)} veh/min`}
            detail={`Completed vehicles: ${state?.vehicles_served_this_run || 0}`}
            onClick={() => setMetricsOpen(true)}
          />
          <StatCard
            title="Congestion"
            value={(state?.current_avg_congestion || 0).toFixed(1)}
            detail={`Spillbacks: ${state?.spillback_events || 0} | ${spillbackDetail}`}
          />
          <StatCard
            title="Green Wave"
            value={`${(((state?.green_wave_success_rate || 0) * 100).toFixed(1))}%`}
            detail={
              state?.baseline_green_wave_success_rate != null
                ? `Fixed baseline: ${(state.baseline_green_wave_success_rate * 100).toFixed(1)}%`
                : 'Baseline appears after a fixed run'
            }
          />
          <StatCard
            title="Summary"
            value={state?.network_summary || 'Clear roads'}
            detail={spillbackDetail}
            accent={summaryTone}
          />
        </div>

        <JunctionMetricsPanel
          intersections={state?.intersections || []}
          junctionMetrics={state?.junction_metrics || {}}
          currentComparison={state?.current_junction_comparison || {}}
          baselineComparison={state?.baseline_junction_comparison || {}}
          baselineRunId={state?.baseline_run_id}
          baselineScenario={state?.baseline_scenario}
          baselineDuration={state?.baseline_duration_s}
          currentScenario={state?.scenario}
          currentMode={networkMode}
          baselineAvailable={baselineAvailable}
          selectedIntersectionId={selectedIntersectionId}
          onSelect={setSelectedIntersectionId}
          onInjectEmergency={injectEmergency}
        />

        <AgentStatusPanel
          intersections={state?.intersections || []}
          junctionMetrics={state?.junction_metrics || {}}
          networkMode={networkMode}
        />

        {networkMode === 'adaptive' && <EventLogPanel alerts={state?.alerts || []} />}

        <div className="grid gap-4 xl:grid-cols-2">
          <ComparisonChart
            title="Average Wait"
            data={comparisonSeries}
            currentLabel={currentLabel}
            baselineLabel={overlayLabel}
            currentKey="currentWait"
            baselineKey="baselineWait"
            formatter={(value) => formatSeconds(Number(value || 0))}
            currentStroke={currentStroke}
            domainMax={chartDomainMax}
          />
          <ComparisonChart
            title="Throughput"
            data={comparisonSeries}
            currentLabel={currentLabel}
            baselineLabel={overlayLabel}
            currentKey="currentThroughput"
            baselineKey="baselineThroughput"
            formatter={(value) => `${Number(value || 0).toFixed(1)}`}
            currentStroke={currentStroke}
            domainMax={chartDomainMax}
          />
          <ComparisonChart
            title="Congestion"
            data={comparisonSeries}
            currentLabel={currentLabel}
            baselineLabel={overlayLabel}
            currentKey="currentCongestion"
            baselineKey="baselineCongestion"
            formatter={(value) => `${Number(value || 0).toFixed(1)}`}
            currentStroke={currentStroke}
            domainMax={chartDomainMax}
          />
          <ComparisonChart
            title="Green Wave"
            data={comparisonSeries}
            currentLabel={currentLabel}
            baselineLabel={overlayLabel}
            currentKey="currentGreenWave"
            baselineKey="baselineGreenWave"
            formatter={(value) => `${Number(value || 0).toFixed(1)}%`}
            currentStroke={currentStroke}
            domainMax={chartDomainMax}
          />
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Run History</div>
            <div className="text-lg font-bold text-slate-900">Multi-junction runs by mode</div>
            <div className="text-sm text-slate-500">
              Each completed run on this multi-grid network is recorded below. Fixed-time and adaptive runs are tracked separately so you can compare totals and averages across modes.
            </div>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <RunHistoryTable title="Fixed Time" runs={fixedRuns} accent="text-slate-700" />
            <RunHistoryTable title="Adaptive" runs={adaptiveRuns} accent="text-emerald-700" />
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      <MetricsPopup
        open={metricsOpen}
        state={state}
        currentSeries={currentSeries}
        onClose={() => setMetricsOpen(false)}
      />
    </div>
  );
}
