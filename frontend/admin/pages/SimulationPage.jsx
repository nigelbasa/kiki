import { useEffect, useMemo, useRef, useState } from 'react';
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

function StatCard({ title, value, detail, accent = 'text-slate-900' }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className={`mt-3 text-2xl font-bold ${accent}`}>{value}</div>
      {detail && <div className="mt-2 text-sm text-slate-500">{detail}</div>}
    </div>
  );
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
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="tick" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={formatter} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => formatter(value)} />
            <Legend />
            <Line type="monotone" dataKey={baselineKey} name={baselineLabel} stroke="#94a3b8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey={currentKey} name={currentLabel} stroke={currentStroke} strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function JunctionMetricsModal({
  open,
  intersections,
  junctionMetrics,
  currentComparison,
  baselineComparison,
  currentMode,
  selectedIntersectionId,
  onSelect,
  onClose,
}) {
  if (!open) return null;

  const selectedIntersection =
    intersections.find((intersection) => intersection.id === selectedIntersectionId) || intersections[0] || null;
  const selectedMetrics = selectedIntersection ? junctionMetrics?.[selectedIntersection.id] : null;
  const selectedCurrentComparison = selectedIntersection ? currentComparison?.[selectedIntersection.id] : null;
  const selectedBaselineComparison = selectedIntersection ? baselineComparison?.[selectedIntersection.id] : null;
  const selectedTotalQueue = selectedIntersection
    ? selectedIntersection.approaches.reduce((sum, approach) => {
        const isNorthSouth = approach.direction === 'NS';
        const livePresence = isNorthSouth ? selectedMetrics?.ns_presence : selectedMetrics?.ew_presence;
        return sum + liveApproachCount(approach, livePresence);
      }, 0)
    : 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Live Junction View</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">Per-Traffic-Light Metrics</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="border-b border-slate-200 bg-slate-50 p-4 lg:border-b-0 lg:border-r">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Junctions</div>
            <div className="mt-4 space-y-2">
              {intersections.map((intersection) => {
                const active = intersection.id === selectedIntersection?.id;
                const metrics = junctionMetrics?.[intersection.id];
                const totalQueue = intersection.approaches.reduce((sum, approach) => {
                  const isNorthSouth = approach.direction === 'NS';
                  const livePresence = isNorthSouth ? metrics?.ns_presence : metrics?.ew_presence;
                  return sum + liveApproachCount(approach, livePresence);
                }, 0);
                return (
                  <button
                    key={intersection.id}
                    type="button"
                    onClick={() => onSelect(intersection.id)}
                    className={`w-full rounded-[20px] border px-4 py-3 text-left transition ${
                      active
                        ? 'border-rwendo-accent bg-white shadow-sm'
                        : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white'
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      {formatIntersectionName(intersection.id, intersection.name)}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{intersection.id}</div>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Vehicles now</span>
                      <span className="font-semibold text-slate-900">{totalQueue.toFixed(0)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-6">
            {!selectedIntersection ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-slate-500">
                No junction data available yet.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Live Detail
                    </div>
                    <div className="mt-1 text-2xl font-bold text-slate-900">
                      {formatIntersectionName(selectedIntersection.id, selectedIntersection.name)}
                    </div>
                    <div className="mt-2 text-sm text-slate-500">
                      Mode: {selectedIntersection.mode} | Emergency: {selectedIntersection.emergency_state}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${
                        selectedIntersection.spillback_active
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {selectedIntersection.spillback_active ? 'Spillback Active' : 'Flow Stable'}
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <StatCard
                    title="Vehicles On Approaches"
                    value={selectedTotalQueue.toFixed(0)}
                    detail="Combined live count across both approaches"
                  />
                  <StatCard
                    title="Approach Presence"
                    value={((selectedMetrics?.ns_presence || 0) + (selectedMetrics?.ew_presence || 0)).toFixed(1)}
                    detail="Vehicles currently detected on inbound approaches"
                  />
                  <StatCard
                    title="Signal Mode"
                    value={String(selectedIntersection.mode || 'fixed').toUpperCase()}
                    detail={`Emergency state: ${selectedIntersection.emergency_state}`}
                    accent="text-rwendo-accent"
                  />
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Junction Comparison
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        Run fixed first to store a baseline, then switch to adaptive to compare the same junction.
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-600">
                      {currentMode === 'adaptive' && selectedBaselineComparison ? 'Fixed vs adaptive' : 'Current run only'}
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="pb-3 pr-4 font-semibold">Metric</th>
                          <th className="pb-3 pr-4 font-semibold">Fixed Baseline</th>
                          <th className="pb-3 font-semibold">
                            {currentMode === 'adaptive' ? 'Adaptive Run' : 'Current Run'}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700">
                        <tr className="border-b border-slate-100">
                          <td className="py-3 pr-4 font-semibold">Average wait</td>
                          <td className="py-3 pr-4">
                            {selectedBaselineComparison ? `${Number(selectedBaselineComparison.avg_wait_time || 0).toFixed(1)}s` : 'Not stored yet'}
                          </td>
                          <td className="py-3">
                            {`${Number(selectedCurrentComparison?.avg_wait_time || 0).toFixed(1)}s`}
                          </td>
                        </tr>
                        <tr className="border-b border-slate-100">
                          <td className="py-3 pr-4 font-semibold">Vehicle count</td>
                          <td className="py-3 pr-4">
                            {selectedBaselineComparison ? Number(selectedBaselineComparison.vehicle_count || 0).toFixed(0) : 'Not stored yet'}
                          </td>
                          <td className="py-3">{Number(selectedCurrentComparison?.vehicle_count || 0).toFixed(0)}</td>
                        </tr>
                        <tr className="border-b border-slate-100">
                          <td className="py-3 pr-4 font-semibold">Throughput</td>
                          <td className="py-3 pr-4">
                            {selectedBaselineComparison ? `${Number(selectedBaselineComparison.throughput_vpm || 0).toFixed(1)} veh/min` : 'Not stored yet'}
                          </td>
                          <td className="py-3">{`${Number(selectedCurrentComparison?.throughput_vpm || 0).toFixed(1)} veh/min`}</td>
                        </tr>
                        <tr>
                          <td className="py-3 pr-4 font-semibold">Congestion (spillback)</td>
                          <td className="py-3 pr-4">
                            {selectedBaselineComparison ? `${Number(selectedBaselineComparison.spillback_events || 0).toFixed(0)} events` : 'Not stored yet'}
                          </td>
                          <td className="py-3">{`${Number(selectedCurrentComparison?.spillback_events || 0).toFixed(0)} events`}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  {selectedIntersection.approaches.map((approach) => {
                    const isNorthSouth = approach.direction === 'NS';
                    const livePresence = isNorthSouth ? selectedMetrics?.ns_presence : selectedMetrics?.ew_presence;
                    const approachCount = liveApproachCount(approach, livePresence);
                    return (
                      <div key={approach.direction} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                              {isNorthSouth ? 'North-South' : 'East-West'} Approach
                            </div>
                            <div className="mt-1 text-xl font-bold text-slate-900">
                              {approachCount} vehicles
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${
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
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Presence
                            </div>
                            <div className="mt-1 text-lg font-bold text-slate-900">{(livePresence || 0).toFixed(1)}</div>
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Countdown
                            </div>
                            <div className="mt-1 text-lg font-bold text-slate-900">{approach.countdown}s</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SimulationPage({ user, detection }) {
  const { state, sendCommand, sendPreempt, connected } = useSimulation();
  const [boundaryKey, setBoundaryKey] = useState(0);
  const [toast, setToast] = useState('');
  const [junctionMetricsOpen, setJunctionMetricsOpen] = useState(false);
  const [selectedIntersectionId, setSelectedIntersectionId] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [fixedBaseline, setFixedBaseline] = useState([]);
  const [health, setHealth] = useState({ backend: 'checking', detection: 'checking' });
  const previousRunRef = useRef({ runId: '', mode: '' });
  const chartDataRef = useRef([]);
  const demoTimersRef = useRef([]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    chartDataRef.current = chartData;
  }, [chartData]);

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

  useEffect(() => () => {
    demoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    demoTimersRef.current = [];
  }, []);

  useEffect(() => {
    if (!state?.intersections?.length) return;
    if (selectedIntersectionId && state.intersections.some((intersection) => intersection.id === selectedIntersectionId)) {
      return;
    }
    setSelectedIntersectionId(state.intersections[0].id);
  }, [selectedIntersectionId, state]);

  useEffect(() => {
    if (!state) return;

    if (previousRunRef.current.runId && previousRunRef.current.runId !== state.run_id) {
      if (previousRunRef.current.mode === 'fixed' && chartDataRef.current.length > 0) {
        setFixedBaseline(chartDataRef.current.map((entry, index) => ({ ...entry, tick: index + 1 })));
      }
      setChartData([]);
      chartDataRef.current = [];
    }

    previousRunRef.current = { runId: state.run_id, mode: state.current_mode };

    if (!state.started || state.tick <= 0) {
      return;
    }

    setChartData((previous) => {
      if (previous.some((entry) => entry.tick === state.tick)) {
        return previous;
      }
      return [
        ...previous,
        {
          tick: state.tick,
          wait: state.current_avg_wait_time,
          throughput: state.current_throughput_vpm,
          congestion: state.current_avg_congestion,
          greenWave: (state.green_wave_success_rate || 0) * 100,
        },
      ].slice(-240);
    });
  }, [state]);

  const networkMode = state?.current_mode || 'fixed';
  const currentLabel = networkMode === 'adaptive' ? 'Adaptive run' : 'Fixed run';
  const overlayLabel = fixedBaseline.length > 0 && networkMode === 'adaptive' ? 'Fixed baseline' : 'Current run';
  const runStatus = !state?.started ? 'READY' : state?.running ? 'LIVE' : 'PAUSED';
  const currentStroke = networkMode === 'adaptive' ? '#22c55e' : '#0f172a';

  const comparisonSeries = useMemo(() => {
    return chartData.map((entry, index) => ({
      tick: entry.tick,
      currentWait: entry.wait,
      currentThroughput: entry.throughput,
      currentCongestion: entry.congestion,
      currentGreenWave: entry.greenWave,
      baselineWait: fixedBaseline[index]?.wait ?? null,
      baselineThroughput: fixedBaseline[index]?.throughput ?? null,
      baselineCongestion: fixedBaseline[index]?.congestion ?? null,
      baselineGreenWave: fixedBaseline[index]?.greenWave ?? null,
    }));
  }, [chartData, fixedBaseline]);

  const spillbackDetail = formatIntersectionList(state?.spillback_locations || [], state?.intersections || []);
  const summaryTone = formatSummaryTone(state?.network_summary);

  function setNetworkMode(mode) {
    sendCommand('set_network_mode', { mode });
    setBoundaryKey((value) => value + 1);
    setChartData([]);
    chartDataRef.current = [];
    setToast(`Mode set to ${mode === 'adaptive' ? 'adaptive' : 'fixed time'}. Press Start Run to begin.`);
  }

  function startRun() {
    sendCommand('start_run');
    setToast(`Started ${networkMode === 'adaptive' ? 'adaptive' : 'fixed time'} run`);
  }

  function resetRun() {
    demoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    demoTimersRef.current = [];
    sendCommand('reset');
    setBoundaryKey((value) => value + 1);
    setChartData([]);
    chartDataRef.current = [];
    setToast('Run reset. Press Start Run when you are ready.');
  }

  function startGuidedDemo() {
    demoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    demoTimersRef.current = [];

    sendCommand('reset');
    sendCommand('set_scenario', { scenario: 'peak' });
    sendCommand('set_network_mode', { mode: 'fixed' });
    setToast('Guided demo started: fixed baseline first, then adaptive, then emergency pre-emption.');

    demoTimersRef.current.push(window.setTimeout(() => {
      sendCommand('start_run');
    }, 1200));

    demoTimersRef.current.push(window.setTimeout(() => {
      sendCommand('set_network_mode', { mode: 'adaptive' });
      sendCommand('start_run');
      setToast('Guided demo moved to adaptive mode.');
    }, 19000));

    demoTimersRef.current.push(window.setTimeout(() => {
      sendPreempt('TL_11', 'NS');
      setToast('Guided demo triggered emergency pre-emption at TL_11.');
    }, 32000));
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
                <button
                  onClick={resetRun}
                  className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Reset
                </button>
                <button
                  onClick={startGuidedDemo}
                  className="rounded-full border border-rwendo-accent px-5 py-3 text-sm font-semibold text-rwendo-accent transition hover:bg-rwendo-accent hover:text-white"
                >
                  Guided Demo
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
          />
          <StatCard
            title="Throughput"
            value={`${(state?.current_throughput_vpm || 0).toFixed(1)} veh/min`}
            detail={`Completed vehicles: ${state?.vehicles_served_this_run || 0}`}
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

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Live Junction Metrics</div>
            <button
              type="button"
              onClick={() => setJunctionMetricsOpen(true)}
              className="rounded-full border border-rwendo-accent px-5 py-3 text-sm font-semibold text-rwendo-accent transition hover:bg-rwendo-accent hover:text-white"
            >
              View Junction Metrics
            </button>
          </div>
        </div>

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
          />
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      <JunctionMetricsModal
        open={junctionMetricsOpen}
        intersections={state?.intersections || []}
        junctionMetrics={state?.junction_metrics || {}}
        currentComparison={state?.current_junction_comparison || {}}
        baselineComparison={state?.baseline_junction_comparison || {}}
        currentMode={networkMode}
        selectedIntersectionId={selectedIntersectionId}
        onSelect={setSelectedIntersectionId}
        onClose={() => setJunctionMetricsOpen(false)}
      />
    </div>
  );
}
