import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { api } from '@shared/api/client';
import { useSimulation } from '@shared/hooks/useSimulation';
import { formatIntersectionName } from '@shared/utils/intersections';

const FORECAST_HORIZONS = [
  { key: '1h', label: 'Next 1 Hour', hours: 1 },
  { key: '5h', label: 'Next 5 Hours', hours: 5 },
  { key: '1d', label: 'Next 24 Hours', hours: 24 },
  { key: '5d', label: 'Next 5 Days', hours: 120 },
];

function formatDuration(ticks) {
  const seconds = Math.floor((ticks || 0) / 20);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function runTime(run) {
  return new Date(run?.ran_at || run?.ended_at || run?.started_at || 0).getTime();
}

function chooseComparisonPair(runList) {
  const ordered = [...runList].sort((a, b) => runTime(b) - runTime(a));
  const adaptiveRun = ordered.find((run) => run.mode === 'adaptive' && (run.duration_ticks || 0) > 0);
  if (!adaptiveRun) return { adaptiveRun: null, fixedRun: null };

  const fixedRun = ordered.find(
    (run) =>
      run.mode === 'fixed' &&
      run.scenario === adaptiveRun.scenario &&
      run.run_id !== adaptiveRun.run_id &&
      runTime(run) <= runTime(adaptiveRun) &&
      (run.duration_ticks || 0) > 0,
  );

  return {
    adaptiveRun,
    fixedRun: fixedRun || ordered.find((run) => run.mode === 'fixed' && run.run_id !== adaptiveRun.run_id) || null,
  };
}

function waitValue(run) {
  if (typeof run?.avg_wait_time === 'number') return run.avg_wait_time;
  return run?.mode === 'adaptive' ? run?.avg_wait_time_adaptive || 0 : run?.avg_wait_time_fixed || 0;
}

function deltaString(current, baseline, suffix = '') {
  const delta = current - baseline;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}${suffix}`;
}

function formatScenario(value) {
  if (value === 'off_peak') return 'Off-Peak';
  if (value === 'peak') return 'Peak';
  return String(value || '').replace('_', ' ');
}

function formatMode(value) {
  if (value === 'adaptive') return 'Adaptive';
  if (value === 'fixed') return 'Fixed-Time';
  return String(value || '');
}

function formatTimestamp(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function spillbackFrequencyPerHour(run) {
  const hours = Math.max((Number(run?.duration_ticks || 0) / 20) / 3600, 1 / 3600);
  return Number(run?.spillback_events || 0) / hours;
}

function emergencyTravelTimeValue(run) {
  if (!run) return 0;
  return Number(run.avg_emergency_travel_time || 0);
}

function ComparisonMetricTable({ title, unitLabel, rows }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-3 pr-4 font-semibold">Metric</th>
              <th className="pb-3 pr-4 font-semibold">Fixed-Time</th>
              <th className="pb-3 pr-4 font-semibold">Adaptive</th>
              <th className="pb-3 font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-slate-100">
                <td className="py-3 pr-4 font-semibold">{row.label}</td>
                <td className="py-3 pr-4">{row.fixedValue}</td>
                <td className="py-3 pr-4">{row.adaptiveValue}</td>
                <td className="py-3">{row.delta ?? unitLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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

function DualSeriesChart({ title, rows, adaptiveKey, fixedKey, formatter, xKey = 'label' }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={formatter} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => formatter(value)} />
            <Legend />
            <Line type="monotone" dataKey={fixedKey} name="Fixed" stroke="#94a3b8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey={adaptiveKey} name="Adaptive" stroke="#22c55e" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function scenarioMultiplier(scenario, hours) {
  if (scenario === 'peak') {
    if (hours <= 1) return 1.08;
    if (hours <= 5) return 1.12;
    if (hours <= 24) return 1.04;
    return 1.09;
  }
  if (hours <= 1) return 0.96;
  if (hours <= 5) return 0.94;
  if (hours <= 24) return 0.99;
  return 1.03;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function junctionAggregates(runs) {
  const aggregates = {};

  runs.forEach((run) => {
    Object.entries(run.junction_metrics || {}).forEach(([junctionId, metrics]) => {
      if (!aggregates[junctionId]) {
        aggregates[junctionId] = {
          fixedQueue: [],
          adaptiveQueue: [],
          fixedPresence: [],
          adaptivePresence: [],
          recentPresence: [],
        };
      }
      const queue = (metrics.avg_ns_queue || 0) + (metrics.avg_ew_queue || 0);
      const presence = (metrics.avg_ns_presence || 0) + (metrics.avg_ew_presence || 0);
      if (run.mode === 'adaptive') {
        aggregates[junctionId].adaptiveQueue.push(queue);
        aggregates[junctionId].adaptivePresence.push(presence);
      } else {
        aggregates[junctionId].fixedQueue.push(queue);
        aggregates[junctionId].fixedPresence.push(presence);
      }
      aggregates[junctionId].recentPresence.push({ time: runTime(run), presence });
    });
  });

  return aggregates;
}

export default function AnalyticsPage() {
  const { state, connected } = useSimulation();
  const [runs, setRuns] = useState([]);
  const [comparison, setComparison] = useState(null);
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
      const runList = await api.get('/api/analytics/runs');
      setRuns(runList);

      const { adaptiveRun, fixedRun } = chooseComparisonPair(runList);
      if (adaptiveRun && fixedRun) {
        const compare = await api.get(
          `/api/analytics/compare?run_a=${encodeURIComponent(fixedRun.run_id)}&run_b=${encodeURIComponent(adaptiveRun.run_id)}`,
        );
        setComparison(compare);
      } else {
        setComparison(null);
      }
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
    const intervalMs = state?.running ? 2500 : 5000;
    const interval = window.setInterval(() => {
      load({ silent: true });
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [load, state?.running]);

  const fixedRun = comparison?.run_a || null;
  const adaptiveRun = comparison?.run_b || null;
  const liveIntersections = state?.intersections || [];
  const liveJunctionMetrics = state?.junction_metrics || {};

  const comparisonRows = useMemo(() => {
    const fixedSnapshots = fixedRun?.snapshots || [];
    const adaptiveSnapshots = adaptiveRun?.snapshots || [];
    const length = Math.max(fixedSnapshots.length, adaptiveSnapshots.length);
    return Array.from({ length }, (_, index) => ({
      tick: index + 1,
      fixed_wait: fixedSnapshots[index]?.avg_wait_time ?? null,
      adaptive_wait: adaptiveSnapshots[index]?.avg_wait_time ?? null,
      fixed_throughput: fixedSnapshots[index]?.throughput_per_min ?? null,
      adaptive_throughput: adaptiveSnapshots[index]?.throughput_per_min ?? null,
      fixed_congestion: fixedSnapshots[index]?.avg_congestion ?? null,
      adaptive_congestion: adaptiveSnapshots[index]?.avg_congestion ?? null,
      fixed_vehicles: fixedSnapshots[index]?.vehicles_completed ?? null,
      adaptive_vehicles: adaptiveSnapshots[index]?.vehicles_completed ?? null,
    }));
  }, [adaptiveRun, fixedRun]);

  const historicalRows = useMemo(() => {
    const ordered = [...runs]
      .filter((run) => (run.duration_ticks || 0) > 0)
      .sort((a, b) => runTime(a) - runTime(b))
      .slice(-10);

    return ordered.map((run, index) => ({
      label: `Run ${String(index + 1).padStart(2, '0')}`,
      modeLabel: formatMode(run.mode),
      adaptive_wait: run.mode === 'adaptive' ? waitValue(run) : null,
      fixed_wait: run.mode === 'fixed' ? waitValue(run) : null,
      adaptive_throughput: run.mode === 'adaptive' ? run.throughput_per_min || 0 : null,
      fixed_throughput: run.mode === 'fixed' ? run.throughput_per_min || 0 : null,
      adaptive_congestion: run.mode === 'adaptive' ? run.avg_congestion || 0 : null,
      fixed_congestion: run.mode === 'fixed' ? run.avg_congestion || 0 : null,
      adaptive_vehicles: run.mode === 'adaptive' ? run.vehicles_completed || 0 : null,
      fixed_vehicles: run.mode === 'fixed' ? run.vehicles_completed || 0 : null,
    }));
  }, [runs]);

  const recentRuns = useMemo(() => {
    return [...runs]
      .filter((run) => (run.duration_ticks || 0) > 0)
      .sort((a, b) => runTime(b) - runTime(a))
      .slice(0, 8);
  }, [runs]);

  const networkForecastRows = useMemo(() => {
    const completedRuns = [...runs]
      .filter((run) => (run.duration_ticks || 0) > 0)
      .sort((a, b) => runTime(b) - runTime(a))
      .slice(0, 6);

    const recentThroughput = average(completedRuns.map((run) => Number(run.throughput_per_min || 0)).filter((value) => value > 0));
    const recentDelay = average(completedRuns.map((run) => waitValue(run)).filter((value) => value > 0));
    const recentCongestion = average(completedRuns.map((run) => Number(run.avg_congestion || 0)).filter((value) => value > 0));

    const baseThroughput = Math.max(Number(state?.current_throughput_vpm || 0), recentThroughput, 0.1);
    const baseDelay = Math.max(Number(state?.current_avg_wait_time || 0), recentDelay, 0.1);
    const baseCongestion = Math.max(Number(state?.current_avg_congestion || 0), recentCongestion, 0.1);
    const activeVolume =
      (state?.intersections || []).reduce((sum, intersection) => {
        const metrics = state?.junction_metrics?.[intersection.id] || {};
        return sum + Number(metrics.ns_presence || 0) + Number(metrics.ew_presence || 0);
      }, 0);

    return FORECAST_HORIZONS.map((horizon) => {
      const multiplier = scenarioMultiplier(state?.scenario, horizon.hours);
      const growth = 1 + Math.min(horizon.hours / 48, 0.18);
      const projectedVehicleCount = Math.round(baseThroughput * 60 * horizon.hours * multiplier * growth);
      const projectedDelay = baseDelay * Math.max(0.92, multiplier) * (1 + activeVolume / 220);
      const projectedCongestion = baseCongestion * multiplier * (1 + activeVolume / 260);
      return {
        label: horizon.label,
        vehicleCount: projectedVehicleCount,
        averageDelay: projectedDelay,
        congestionIndex: projectedCongestion,
      };
    });
  }, [runs, state]);

  const junctionRows = useMemo(() => {
    const aggregates = junctionAggregates(runs);
    const livePresenceTotals = liveIntersections.map((intersection) => {
      const metrics = liveJunctionMetrics[intersection.id] || {};
      return (metrics.ns_presence || 0) + (metrics.ew_presence || 0);
    });
    const networkPresence = average(livePresenceTotals) > 0
      ? livePresenceTotals.reduce((sum, value) => sum + value, 0)
      : 0;

    const liveBaseRate =
      (state?.current_throughput_vpm || 0) +
      (state?.current_avg_congestion || 0) * 0.85 +
      livePresenceTotals.reduce((sum, value) => sum + value, 0) * 0.35;

    return liveIntersections.map((intersection) => {
      const metrics = liveJunctionMetrics[intersection.id] || {};
      const history = aggregates[intersection.id] || {
        fixedQueue: [],
        adaptiveQueue: [],
        fixedPresence: [],
        adaptivePresence: [],
        recentPresence: [],
      };

      const currentPresence = (metrics.ns_presence || 0) + (metrics.ew_presence || 0);
      const currentQueue = (metrics.ns_queue || 0) + (metrics.ew_queue || 0);
      const historicalPresence =
        average(history.adaptivePresence) || average(history.fixedPresence) || currentPresence || 1;
      const share = networkPresence > 0 ? currentPresence / networkPresence : historicalPresence / Math.max(liveIntersections.length * historicalPresence, 1);

      const recentPresence = [...history.recentPresence].sort((a, b) => a.time - b.time).slice(-4);
      const olderPresence = recentPresence.slice(0, 2).map((entry) => entry.presence);
      const newerPresence = recentPresence.slice(-2).map((entry) => entry.presence);
      const trendRatio = olderPresence.length && newerPresence.length
        ? average(newerPresence) / Math.max(average(olderPresence), 0.1)
        : 1;

      const forecasts = FORECAST_HORIZONS.reduce((acc, horizon) => {
        const projected =
          liveBaseRate *
          Math.max(share, 0.12) *
          horizon.hours *
          60 *
          scenarioMultiplier(state?.scenario, horizon.hours) *
          trendRatio;
        acc[horizon.key] = Math.round(projected);
        return acc;
      }, {});

      return {
        id: intersection.id,
        name: formatIntersectionName(intersection.id, intersection.name),
        currentPresence,
        currentQueue,
        fixedAvgQueue: average(history.fixedQueue),
        adaptiveAvgQueue: average(history.adaptiveQueue),
        fixedAvgPresence: average(history.fixedPresence),
        adaptiveAvgPresence: average(history.adaptivePresence),
        averageDelay: Math.max((currentQueue * 2.4) + 4, average(history.adaptiveQueue) * 1.8, average(history.fixedQueue) * 1.8),
        congestionIndex: Math.max(currentQueue * 0.55 + currentPresence * 0.18, average(history.adaptiveQueue), average(history.fixedQueue)),
        forecasts,
      };
    });
  }, [liveIntersections, liveJunctionMetrics, runs, state]);

  const spillbackComparisonRows = useMemo(() => {
    if (!fixedRun || !adaptiveRun) return [];
    const fixedFreq = spillbackFrequencyPerHour(fixedRun);
    const adaptiveFreq = spillbackFrequencyPerHour(adaptiveRun);
    return [
      {
        label: 'Spillback events per hour',
        fixedValue: `${fixedFreq.toFixed(2)} events/hr`,
        adaptiveValue: `${adaptiveFreq.toFixed(2)} events/hr`,
        delta: deltaString(adaptiveFreq, fixedFreq),
      },
      {
        label: 'Total spillback events',
        fixedValue: String(fixedRun.spillback_events || 0),
        adaptiveValue: String(adaptiveRun.spillback_events || 0),
        delta: String((adaptiveRun.spillback_events || 0) - (fixedRun.spillback_events || 0)),
      },
    ];
  }, [adaptiveRun, fixedRun]);

  const waitTimeComparisonRows = useMemo(() => {
    if (!fixedRun || !adaptiveRun) return [];
    const fixedWait = waitValue(fixedRun);
    const adaptiveWait = waitValue(adaptiveRun);
    return [
      {
        label: 'Average wait time',
        fixedValue: `${fixedWait.toFixed(1)}s`,
        adaptiveValue: `${adaptiveWait.toFixed(1)}s`,
        delta: deltaString(adaptiveWait, fixedWait, 's'),
      },
      {
        label: 'Total accumulated delay',
        fixedValue: `${Number(fixedRun.total_wait_seconds || 0).toFixed(1)}s`,
        adaptiveValue: `${Number(adaptiveRun.total_wait_seconds || 0).toFixed(1)}s`,
        delta: deltaString(Number(adaptiveRun.total_wait_seconds || 0), Number(fixedRun.total_wait_seconds || 0), 's'),
      },
    ];
  }, [adaptiveRun, fixedRun]);

  const emergencyTravelComparisonRows = useMemo(() => {
    if (!fixedRun || !adaptiveRun) return [];
    const fixedTravel = emergencyTravelTimeValue(fixedRun);
    const adaptiveTravel = emergencyTravelTimeValue(adaptiveRun);
    return [
      {
        label: 'Average emergency vehicle travel time',
        fixedValue: `${fixedTravel.toFixed(1)}s`,
        adaptiveValue: `${adaptiveTravel.toFixed(1)}s`,
        delta: deltaString(adaptiveTravel, fixedTravel, 's'),
      },
      {
        label: 'Emergency vehicles completed',
        fixedValue: String(fixedRun.emergency_vehicles_completed || 0),
        adaptiveValue: String(adaptiveRun.emergency_vehicles_completed || 0),
        delta: String((adaptiveRun.emergency_vehicles_completed || 0) - (fixedRun.emergency_vehicles_completed || 0)),
      },
    ];
  }, [adaptiveRun, fixedRun]);

  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Analytics</h1>
            <p className="mt-2 text-sm text-slate-500">
              Live performance indicators, comparative run trends, and forecast outlook by junction.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {refreshing
                ? 'Refreshing analytics...'
                : lastUpdated
                  ? `Last updated at ${lastUpdated.toLocaleTimeString()}`
                  : 'Waiting for initial analytics snapshot'}
              {connected ? ' | Live connection active' : ' | Live connection unavailable'}
            </p>
          </div>
          <button
            onClick={() => load()}
            className="rounded-full border border-rwendo-accent px-5 py-2 text-sm font-semibold text-rwendo-accent transition hover:bg-rwendo-accent hover:text-white"
          >
            Refresh
          </button>
        </div>

        {loading && <div className="text-sm text-slate-500">Loading analytics...</div>}
        {error && <div className="text-sm text-red-600">Failed to load: {error}</div>}

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="Current Average Delay"
            value={`${(state?.current_avg_wait_time || 0).toFixed(1)}s`}
            detail={`Scenario: ${formatScenario(state?.scenario || 'off_peak')} | Control: ${formatMode(state?.current_mode || 'fixed')}`}
            accent="text-emerald-700"
          />
          <StatCard
            label="Current Throughput"
            value={`${(state?.current_throughput_vpm || 0).toFixed(1)} veh/min`}
            detail={`Vehicles completed in current run: ${state?.vehicles_served_this_run || 0}`}
            accent="text-rwendo-accent"
          />
          <StatCard
            label="Current Congestion Index"
            value={(state?.current_avg_congestion || 0).toFixed(1)}
            detail={`Spillback events: ${state?.spillback_events || 0} | Pre-emption events: ${state?.preemption_events || 0}`}
          />
          <StatCard
            label="Forecast Coverage"
            value={`${liveIntersections.length} junctions`}
            detail="Forecasts combine live approach demand with recent historical patterns"
          />
        </div>

        {comparison && fixedRun && adaptiveRun ? (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              <DualSeriesChart
                title="Latest Delay Comparison"
                rows={comparisonRows}
                adaptiveKey="adaptive_wait"
                fixedKey="fixed_wait"
                formatter={(value) => `${Number(value || 0).toFixed(1)}s`}
                xKey="tick"
              />
              <DualSeriesChart
                title="Latest Throughput Comparison"
                rows={comparisonRows}
                adaptiveKey="adaptive_throughput"
                fixedKey="fixed_throughput"
                formatter={(value) => `${Number(value || 0).toFixed(1)}`}
                xKey="tick"
              />
              <DualSeriesChart
                title="Latest Congestion Comparison"
                rows={comparisonRows}
                adaptiveKey="adaptive_congestion"
                fixedKey="fixed_congestion"
                formatter={(value) => `${Number(value || 0).toFixed(1)}`}
                xKey="tick"
              />
              <DualSeriesChart
                title="Latest Completed Vehicles Comparison"
                rows={comparisonRows}
                adaptiveKey="adaptive_vehicles"
                fixedKey="fixed_vehicles"
                formatter={(value) => `${Number(value || 0).toFixed(0)}`}
                xKey="tick"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                label="Adaptive Average Delay"
                value={`${waitValue(adaptiveRun).toFixed(1)}s`}
                detail={`Fixed-Time: ${waitValue(fixedRun).toFixed(1)}s | Difference ${deltaString(waitValue(adaptiveRun), waitValue(fixedRun), 's')}`}
                accent="text-emerald-700"
              />
              <StatCard
                label="Adaptive Throughput"
                value={`${(adaptiveRun.throughput_per_min || 0).toFixed(1)} veh/min`}
                detail={`Fixed-Time: ${(fixedRun.throughput_per_min || 0).toFixed(1)} | Difference ${deltaString(adaptiveRun.throughput_per_min || 0, fixedRun.throughput_per_min || 0)}`}
                accent="text-emerald-700"
              />
              <StatCard
                label="Adaptive Congestion Index"
                value={(adaptiveRun.avg_congestion || 0).toFixed(1)}
                detail={`Fixed-Time: ${(fixedRun.avg_congestion || 0).toFixed(1)} | Difference ${deltaString(adaptiveRun.avg_congestion || 0, fixedRun.avg_congestion || 0)}`}
              />
              <StatCard
                label="Comparison Set"
                value={`${formatScenario(adaptiveRun.scenario)} Scenario`}
                detail={`Fixed-Time ${formatDuration(fixedRun.duration_ticks)} | Adaptive ${formatDuration(adaptiveRun.duration_ticks)}`}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <ComparisonMetricTable
                title="Spillback Frequency Comparison"
                unitLabel=""
                rows={spillbackComparisonRows}
              />
              <ComparisonMetricTable
                title="Average Wait Time Comparison"
                unitLabel=""
                rows={waitTimeComparisonRows}
              />
              <ComparisonMetricTable
                title="Emergency Vehicle Travel Time Comparison"
                unitLabel=""
                rows={emergencyTravelComparisonRows}
              />
            </div>
          </>
        ) : (
          !loading && (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
              Run a fixed baseline and an adaptive run to populate direct comparison analytics.
            </div>
          )
        )}

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <DualSeriesChart
              title="Average Delay Across Recent Runs"
              rows={historicalRows}
              adaptiveKey="adaptive_wait"
              fixedKey="fixed_wait"
              formatter={(value) => `${Number(value || 0).toFixed(1)}s`}
            />
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
              Forecast Summary
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-3 pr-4 font-semibold">Forecast Horizon</th>
                    <th className="pb-3 pr-4 font-semibold">Projected Vehicle Count</th>
                    <th className="pb-3 pr-4 font-semibold">Projected Average Delay</th>
                    <th className="pb-3 font-semibold">Projected Congestion Index</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {networkForecastRows.map((row) => (
                    <tr key={row.label} className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-semibold">{row.label}</td>
                      <td className="py-3 pr-4">{row.vehicleCount}</td>
                      <td className="py-3 pr-4">{row.averageDelay.toFixed(1)}s</td>
                      <td className="py-3">{row.congestionIndex.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <DualSeriesChart
            title="Throughput Across Recent Runs"
            rows={historicalRows}
            adaptiveKey="adaptive_throughput"
            fixedKey="fixed_throughput"
            formatter={(value) => `${Number(value || 0).toFixed(1)}`}
          />
          <DualSeriesChart
            title="Congestion Index Across Recent Runs"
            rows={historicalRows}
            adaptiveKey="adaptive_congestion"
            fixedKey="fixed_congestion"
            formatter={(value) => `${Number(value || 0).toFixed(1)}`}
          />
          <DualSeriesChart
            title="Completed Vehicles Across Recent Runs"
            rows={historicalRows}
            adaptiveKey="adaptive_vehicles"
            fixedKey="fixed_vehicles"
            formatter={(value) => `${Number(value || 0).toFixed(0)}`}
          />
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
            Recent Run History
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="pb-3 pr-4 font-semibold">Recorded At</th>
                  <th className="pb-3 pr-4 font-semibold">Mode</th>
                  <th className="pb-3 pr-4 font-semibold">Scenario</th>
                  <th className="pb-3 pr-4 font-semibold">Duration</th>
                  <th className="pb-3 pr-4 font-semibold">Average Delay</th>
                  <th className="pb-3 pr-4 font-semibold">Throughput</th>
                  <th className="pb-3 pr-4 font-semibold">Congestion Index</th>
                  <th className="pb-3 font-semibold">Vehicles Completed</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {recentRuns.map((run) => (
                  <tr key={run.run_id} className="border-b border-slate-100">
                    <td className="py-3 pr-4">{formatTimestamp(run.ran_at || run.ended_at || run.started_at)}</td>
                    <td className="py-3 pr-4 font-semibold">{formatMode(run.mode)}</td>
                    <td className="py-3 pr-4">{formatScenario(run.scenario)}</td>
                    <td className="py-3 pr-4">{formatDuration(run.duration_ticks)}</td>
                    <td className="py-3 pr-4">{waitValue(run).toFixed(1)}s</td>
                    <td className="py-3 pr-4">{Number(run.throughput_per_min || 0).toFixed(1)} veh/min</td>
                    <td className="py-3 pr-4">{Number(run.avg_congestion || 0).toFixed(1)}</td>
                    <td className="py-3">{run.vehicles_completed || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
            Junction Performance And Forecast Outlook
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="pb-3 pr-4 font-semibold">Junction</th>
                  <th className="pb-3 pr-4 font-semibold">Current Approach Volume</th>
                  <th className="pb-3 pr-4 font-semibold">Current Queue</th>
                  <th className="pb-3 pr-4 font-semibold">Estimated Current Delay</th>
                  <th className="pb-3 pr-4 font-semibold">Estimated Current Congestion</th>
                  <th className="pb-3 pr-4 font-semibold">Historical Fixed-Time Queue</th>
                  <th className="pb-3 pr-4 font-semibold">Historical Adaptive Queue</th>
                  <th className="pb-3 pr-4 font-semibold">Forecast Vehicle Count: 1 Hour</th>
                  <th className="pb-3 font-semibold">Forecast Vehicle Count: 5 Hours</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {junctionRows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-semibold">{row.name}</td>
                    <td className="py-3 pr-4 text-rwendo-accent">{row.currentPresence.toFixed(1)}</td>
                    <td className="py-3 pr-4">{row.currentQueue.toFixed(1)}</td>
                    <td className="py-3 pr-4">{row.averageDelay.toFixed(1)}s</td>
                    <td className="py-3 pr-4">{row.congestionIndex.toFixed(1)}</td>
                    <td className="py-3 pr-4 text-slate-500">{row.fixedAvgQueue.toFixed(1)}</td>
                    <td className="py-3 pr-4 text-emerald-700">{row.adaptiveAvgQueue.toFixed(1)}</td>
                    <td className="py-3 pr-4">{row.forecasts['1h']}</td>
                    <td className="py-3">{row.forecasts['5h']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
