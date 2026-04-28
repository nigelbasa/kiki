import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@shared/api/client';
import { useSimulation } from '@shared/hooks/useSimulation';
import { useSocket } from '@shared/hooks/useSocket';
import { formatIntersectionName } from '@shared/utils/intersections';

function runTime(run) {
  return new Date(run?.ran_at || run?.ended_at || run?.started_at || 0).getTime();
}

function formatScenario(value) {
  if (value === 'off_peak') return 'Off-Peak';
  if (value === 'peak') return 'Peak';
  return String(value || '').replace('_', ' ');
}

function formatTimestamp(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function levelTone(level) {
  if (level === 'high') return 'bg-rose-100 text-rose-700';
  if (level === 'moderate') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatIntersectionData(intersections, predictions) {
  const predictedById = new Map((predictions?.junctions || []).map((row) => [row.id, row]));
  return (intersections || []).map((intersection) => {
    const predicted = predictedById.get(intersection.id);
    return {
      id: intersection.id,
      name: formatIntersectionName(intersection.id, intersection.name),
      current: predicted?.current || {
        avg_wait_time: 0,
        vehicle_count: 0,
        throughput_vpm: 0,
        spillback_events: 0,
        avg_queue: 0,
        avg_presence: 0,
      },
      history: predicted?.history || {
        avg_wait_time: 0,
        vehicle_count: 0,
        throughput_vpm: 0,
        spillback_events: 0,
        avg_queue: 0,
        avg_presence: 0,
      },
      predictive: predicted?.predictions || {
        traffic_jam_risk: { probability: 0, level: 'low' },
        signal_demand: { score: 0, level: 'low' },
      },
    };
  });
}

function StatCard({ label, value, detail, accent = 'text-slate-900' }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-3 text-2xl font-bold ${accent}`}>{value}</div>
      {detail && <div className="mt-2 text-sm text-slate-500">{detail}</div>}
    </div>
  );
}

function TrendChart({ title, rows, dataKey, formatter }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={formatter} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => formatter(value)} />
            <Line type="monotone" dataKey={dataKey} stroke="#22c55e" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PredictionCard({ title, value, detail, level }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${levelTone(level)}`}>
          {level}
        </span>
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{detail}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { state, connected } = useSimulation();
  const { socket } = useSocket();
  const [runs, setRuns] = useState([]);
  const [predictions, setPredictions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);
    try {
      const [runList, predictionPayload] = await Promise.all([
        api.get('/api/analytics/runs'),
        api.get('/api/analytics/predictions'),
      ]);
      setRuns(runList.filter((run) => run.mode === 'adaptive' && (run.duration_ticks || 0) > 0));
      setPredictions(predictionPayload);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onAnalyticsUpdate = (payload) => {
      setRuns((payload?.runs || []).filter((run) => run.mode === 'adaptive' && (run.duration_ticks || 0) > 0));
      setPredictions(payload?.predictions || null);
      setRefreshing(false);
      setLoading(false);
      setLastUpdated(new Date());
    };

    socket.on('analytics:update', onAnalyticsUpdate);
    return () => {
      socket.off('analytics:update', onAnalyticsUpdate);
    };
  }, [socket]);

  const adaptiveRuns = useMemo(() => {
    return [...runs].sort((a, b) => runTime(b) - runTime(a));
  }, [runs]);

  const latestAdaptiveRun = adaptiveRuns[0] || null;

  const trendRows = useMemo(() => {
    return [...adaptiveRuns]
      .reverse()
      .slice(-10)
      .map((run, index) => ({
        label: `Adaptive ${String(index + 1).padStart(2, '0')}`,
        avgWait: Number(run.avg_wait_time || 0),
        throughput: Number(run.throughput_per_min || 0),
        congestion: Number(run.avg_congestion || 0),
        vehicles: Number(run.vehicles_completed || 0),
      }));
  }, [adaptiveRuns]);

  const intersectionRows = useMemo(() => {
    return formatIntersectionData(state?.intersections || [], predictions);
  }, [predictions, state?.intersections]);

  const selectedJunction = intersectionRows[0] || null;
  const networkPredictions = predictions?.network_predictions || {};

  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Analytics</h1>
            <p className="mt-2 text-sm text-slate-500">
              Adaptive-run analytics with per-junction data and model-backed traffic predictions.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {refreshing
                ? 'Refreshing analytics...'
                : lastUpdated
                  ? `Last updated at ${lastUpdated.toLocaleTimeString()}`
                  : 'Waiting for initial analytics snapshot'}
              {connected ? ' | Live connection active' : ' | Live connection unavailable'}
              {predictions?.sample_count ? ` | ML samples: ${predictions.sample_count}` : ''}
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600">
            {connected ? 'Realtime analytics active' : 'Waiting for live analytics'}
          </div>
        </div>

        {loading && <div className="text-sm text-slate-500">Loading analytics...</div>}
        {error && <div className="text-sm text-red-600">Failed to load: {error}</div>}

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="Live Average Delay"
            value={`${(state?.current_avg_wait_time || 0).toFixed(1)}s`}
            detail={`Scenario: ${formatScenario(state?.scenario || 'off_peak')} | Current mode: ${String(state?.current_mode || 'fixed')}`}
            accent="text-emerald-700"
          />
          <StatCard
            label="Latest Adaptive Throughput"
            value={`${Number(latestAdaptiveRun?.throughput_per_min || 0).toFixed(1)} veh/min`}
            detail={latestAdaptiveRun ? `Recorded ${formatTimestamp(latestAdaptiveRun.ran_at || latestAdaptiveRun.ended_at || latestAdaptiveRun.started_at)}` : 'No adaptive run recorded yet'}
            accent="text-rwendo-accent"
          />
          <StatCard
            label="Latest Adaptive Congestion"
            value={Number(latestAdaptiveRun?.avg_congestion || 0).toFixed(1)}
            detail={latestAdaptiveRun ? `Spillback events: ${latestAdaptiveRun.spillback_events || 0}` : 'No adaptive run recorded yet'}
          />
          <StatCard
            label="Adaptive Runs Stored"
            value={String(adaptiveRuns.length)}
            detail="Adaptive history is the baseline for analytics"
          />
        </div>

        {!loading && adaptiveRuns.length === 0 && (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            Run at least one adaptive simulation to populate analytics and train the lightweight predictors.
          </div>
        )}

        {predictions && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">ML Prediction Phase</div>
              <div className="mt-1 text-sm text-slate-500">
                Predictions are generated from stored runs plus the live network state using a lightweight NumPy model.
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <PredictionCard
                title="Traffic Jam Risk"
                value={percent(networkPredictions.traffic_jam_risk?.probability || 0)}
                detail="Likelihood of jam conditions forming in the current network state"
                level={networkPredictions.traffic_jam_risk?.level || 'low'}
              />
              <PredictionCard
                title="Peak Hour"
                value={percent(networkPredictions.peak_hour?.probability || 0)}
                detail="How strongly the current traffic pattern resembles peak-hour behavior"
                level={networkPredictions.peak_hour?.level || 'low'}
              />
              <PredictionCard
                title="Signal Demand"
                value={Number(networkPredictions.signal_demand?.score || 0).toFixed(1)}
                detail="Predicted network signal pressure score"
                level={networkPredictions.signal_demand?.level || 'low'}
              />
              <PredictionCard
                title="Emergency Response"
                value={`${Number(networkPredictions.emergency_response_time?.seconds || 0).toFixed(1)}s`}
                detail="Predicted emergency response travel time under current conditions"
                level={networkPredictions.emergency_response_time?.level || 'low'}
              />
              <PredictionCard
                title="Green-Wave Stability"
                value={`${Number(networkPredictions.green_wave_stability?.percent || 0).toFixed(1)}%`}
                detail="Predicted green-wave success rate"
                level={networkPredictions.green_wave_stability?.level || 'low'}
              />
            </div>
          </div>
        )}

        {adaptiveRuns.length > 0 && (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              <TrendChart
                title="Adaptive Average Delay Trend"
                rows={trendRows}
                dataKey="avgWait"
                formatter={(value) => `${Number(value || 0).toFixed(1)}s`}
              />
              <TrendChart
                title="Adaptive Throughput Trend"
                rows={trendRows}
                dataKey="throughput"
                formatter={(value) => `${Number(value || 0).toFixed(1)}`}
              />
              <TrendChart
                title="Adaptive Congestion Trend"
                rows={trendRows}
                dataKey="congestion"
                formatter={(value) => `${Number(value || 0).toFixed(1)}`}
              />
              <TrendChart
                title="Adaptive Completed Vehicles Trend"
                rows={trendRows}
                dataKey="vehicles"
                formatter={(value) => `${Number(value || 0).toFixed(0)}`}
              />
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                Per-Junction Data
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-3 pr-4 font-semibold">Junction</th>
                      <th className="pb-3 pr-4 font-semibold">Current Wait</th>
                      <th className="pb-3 pr-4 font-semibold">Current Vehicles</th>
                      <th className="pb-3 pr-4 font-semibold">Current Throughput</th>
                      <th className="pb-3 pr-4 font-semibold">Current Spillback</th>
                      <th className="pb-3 pr-4 font-semibold">Historical Wait</th>
                      <th className="pb-3 pr-4 font-semibold">Jam Risk</th>
                      <th className="pb-3 font-semibold">Signal Demand</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    {intersectionRows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-semibold">{row.name}</td>
                        <td className="py-3 pr-4">{Number(row.current.avg_wait_time || 0).toFixed(1)}s</td>
                        <td className="py-3 pr-4">{Number(row.current.vehicle_count || 0).toFixed(0)}</td>
                        <td className="py-3 pr-4">{Number(row.current.throughput_vpm || 0).toFixed(1)} veh/min</td>
                        <td className="py-3 pr-4">{Number(row.current.spillback_events || 0).toFixed(0)}</td>
                        <td className="py-3 pr-4">{Number(row.history.avg_wait_time || 0).toFixed(1)}s</td>
                        <td className="py-3 pr-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${levelTone(row.predictive.traffic_jam_risk?.level || 'low')}`}>
                            {percent(row.predictive.traffic_jam_risk?.probability || 0)}
                          </span>
                        </td>
                        <td className="py-3">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${levelTone(row.predictive.signal_demand?.level || 'low')}`}>
                            {Number(row.predictive.signal_demand?.score || 0).toFixed(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedJunction && (
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Junction Snapshot
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{selectedJunction.name}</div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <StatCard
                      label="Current Queue"
                      value={Number(selectedJunction.current.avg_queue || 0).toFixed(1)}
                      detail={`Presence: ${Number(selectedJunction.current.avg_presence || 0).toFixed(1)}`}
                    />
                    <StatCard
                      label="Historical Throughput"
                      value={`${Number(selectedJunction.history.throughput_vpm || 0).toFixed(1)} veh/min`}
                      detail={`Historical wait: ${Number(selectedJunction.history.avg_wait_time || 0).toFixed(1)}s`}
                      accent="text-rwendo-accent"
                    />
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Junction Prediction
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{selectedJunction.name}</div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <PredictionCard
                      title="Jam Risk"
                      value={percent(selectedJunction.predictive.traffic_jam_risk?.probability || 0)}
                      detail="Predicted junction-level jam formation risk"
                      level={selectedJunction.predictive.traffic_jam_risk?.level || 'low'}
                    />
                    <PredictionCard
                      title="Signal Demand"
                      value={Number(selectedJunction.predictive.signal_demand?.score || 0).toFixed(1)}
                      detail="Predicted signal pressure for this junction"
                      level={selectedJunction.predictive.signal_demand?.level || 'low'}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                Recent Adaptive Run History
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-3 pr-4 font-semibold">Recorded At</th>
                      <th className="pb-3 pr-4 font-semibold">Scenario</th>
                      <th className="pb-3 pr-4 font-semibold">Average Delay</th>
                      <th className="pb-3 pr-4 font-semibold">Throughput</th>
                      <th className="pb-3 pr-4 font-semibold">Congestion</th>
                      <th className="pb-3 pr-4 font-semibold">Vehicles Completed</th>
                      <th className="pb-3 font-semibold">Spillback Events</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    {adaptiveRuns.slice(0, 8).map((run) => (
                      <tr key={run.run_id} className="border-b border-slate-100">
                        <td className="py-3 pr-4">{formatTimestamp(run.ran_at || run.ended_at || run.started_at)}</td>
                        <td className="py-3 pr-4">{formatScenario(run.scenario)}</td>
                        <td className="py-3 pr-4">{Number(run.avg_wait_time || 0).toFixed(1)}s</td>
                        <td className="py-3 pr-4">{Number(run.throughput_per_min || 0).toFixed(1)} veh/min</td>
                        <td className="py-3 pr-4">{Number(run.avg_congestion || 0).toFixed(1)}</td>
                        <td className="py-3 pr-4">{run.vehicles_completed || 0}</td>
                        <td className="py-3">{run.spillback_events || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
