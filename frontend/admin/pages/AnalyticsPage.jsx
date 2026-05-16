import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSocket } from '@shared/hooks/useSocket';

function formatScenario(value) {
  if (value === 'off_peak') return 'Off-Peak';
  if (value === 'peak') return 'Peak';
  return String(value || '').replace('_', ' ');
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function MetricCard({ label, value, detail, accent = 'text-slate-900' }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-3 text-2xl font-bold ${accent}`}>{value}</div>
      {detail && <div className="mt-2 text-sm text-slate-500">{detail}</div>}
    </div>
  );
}

function TrendChart({ title, data, dataKey, formatter, stroke }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={formatter} />
            <Tooltip formatter={(value) => formatter(value)} />
            <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function congestionTone(level) {
  if (level === 'heavy') return 'bg-rose-100 text-rose-700';
  if (level === 'moderate') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

function RealTimeConditions({ state, connected, autoRefreshSeconds, onAutoRefreshChange }) {
  const vehicles = state?.visual_vehicles || [];
  const movingVehicles = vehicles.filter((vehicle) => Number(vehicle.speed || 0) > 0.1);
  const totalVolume = vehicles.length;
  const avgSpeed = movingVehicles.length
    ? movingVehicles.reduce((sum, vehicle) => sum + Number(vehicle.speed || 0), 0) / movingVehicles.length
    : 0;
  const monitoringPoints = state?.intersections?.length || 0;
  const segments = state?.segments || [];
  const summary = state?.network_summary || 'Clear roads';
  const networkMode = String(state?.current_mode || 'fixed').toUpperCase();
  const runStatus = !state?.started ? 'IDLE' : state?.running ? 'LIVE' : 'PAUSED';

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rwendo-accent">Real-Time Traffic Conditions</div>
          <div className="mt-1 text-lg font-bold text-slate-900">Live network snapshot</div>
          <div className="text-sm text-slate-500">
            Updates every tick while the simulation runs. {connected ? 'Live socket connected.' : 'Socket offline.'}
          </div>
        </div>
        <label className="flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700">
          Auto-refresh
          <select
            value={autoRefreshSeconds}
            onChange={(event) => onAutoRefreshChange(Number(event.target.value))}
            className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none"
          >
            <option value={0}>Off</option>
            <option value={5}>5s</option>
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Current Volume"
          value={`${totalVolume} vehicles`}
          detail={`${movingVehicles.length} moving | ${totalVolume - movingVehicles.length} stopped`}
          accent="text-rwendo-accent"
        />
        <MetricCard
          label="Average Speed"
          value={`${avgSpeed.toFixed(1)} m/s`}
          detail={`${(avgSpeed * 3.6).toFixed(1)} km/h (moving vehicles only)`}
          accent="text-emerald-700"
        />
        <MetricCard
          label="Active Monitoring Points"
          value={`${monitoringPoints}`}
          detail={`Traffic signals in the multi-grid network`}
        />
        <MetricCard
          label="System Status"
          value={runStatus}
          detail={`Mode: ${networkMode} | ${summary}`}
          accent={runStatus === 'LIVE' ? 'text-emerald-700' : runStatus === 'PAUSED' ? 'text-amber-700' : 'text-slate-700'}
        />
      </div>

      {segments.length > 0 && (
        <div className="mt-5 rounded-[20px] border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Average speed by zone (road segment)</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {segments.map((segment) => (
              <div key={segment.id} className="flex items-center justify-between rounded-[14px] bg-white px-3 py-2 text-sm">
                <span className="font-semibold text-slate-700">{segment.id}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{Number(segment.vehicles_in_transit || 0)} veh</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${congestionTone(segment.congestion_level)}`}>
                    {segment.congestion_level}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PeriodBadgeList({ title, items }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {items?.length ? (
          items.map((item) => (
            <span
              key={item}
              className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
            >
              {item}
            </span>
          ))
        ) : (
          <span className="text-sm text-slate-500">No stored adaptive history yet.</span>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { socket, connected } = useSocket();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [liveState, setLiveState] = useState(null);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(15);
  const loadRef = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);
    try {
      const result = await api.get('/api/analytics/summary');
      setSummary(result);
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
    api.get('/api/simulation/state').then(setLiveState).catch(() => {});
  }, [load]);

  loadRef.current = load;

  useEffect(() => {
    if (!autoRefreshSeconds) return undefined;
    const interval = window.setInterval(() => {
      loadRef.current?.({ silent: true });
      api.get('/api/simulation/state').then(setLiveState).catch(() => {});
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [autoRefreshSeconds]);

  useEffect(() => {
    const onAnalyticsUpdate = (payload) => {
      setSummary(payload?.summary || null);
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(new Date());
    };
    const onTick = (tick) => setLiveState(tick);

    socket.on('analytics:update', onAnalyticsUpdate);
    socket.on('simulation:tick', onTick);
    return () => {
      socket.off('analytics:update', onAnalyticsUpdate);
      socket.off('simulation:tick', onTick);
    };
  }, [socket]);

  const averages = summary?.averages || {};
  const latestRun = summary?.latest_run || null;
  const trendRows = useMemo(() => summary?.trend_rows || [], [summary]);
  const historyRows = summary?.history_rows || [];
  const adaptiveRunCount = Number(summary?.adaptive_run_count || 0);

  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Analytics</h1>
            <p className="mt-2 text-sm text-slate-500">
              Adaptive-only analytics averaged from stored completed runs.
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
          <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600">
            {connected ? 'Adaptive analytics live' : 'Waiting for analytics feed'}
          </div>
        </div>

        <RealTimeConditions
          state={liveState}
          connected={connected}
          autoRefreshSeconds={autoRefreshSeconds}
          onAutoRefreshChange={setAutoRefreshSeconds}
        />

        {loading && <div className="text-sm text-slate-500">Loading analytics...</div>}
        {error && <div className="text-sm text-red-600">Failed to load: {error}</div>}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Average Wait Time"
            value={`${Number(averages.avg_wait_time || 0).toFixed(1)}s`}
            detail="Average from stored adaptive runs"
            accent="text-emerald-700"
          />
          <MetricCard
            label="Average Throughput"
            value={`${Number(averages.throughput_per_min || 0).toFixed(1)} veh/min`}
            detail="Average adaptive network throughput"
            accent="text-rwendo-accent"
          />
          <MetricCard
            label="Average Queue Length"
            value={Number(averages.avg_queue_length || 0).toFixed(1)}
            detail="Average queued vehicles across the network"
          />
          <MetricCard
            label="Spillback Frequency"
            value={Number(averages.spillback_frequency || 0).toFixed(1)}
            detail="Average spillback events per adaptive run"
          />
          <MetricCard
            label="Emergency Preemptions"
            value={Number(averages.emergency_preemptions || 0).toFixed(1)}
            detail="Average preemption count per adaptive run"
          />
          <MetricCard
            label="Green Wave Success"
            value={`${Number(averages.green_wave_success_rate || 0).toFixed(1)}%`}
            detail={`Stored adaptive runs: ${adaptiveRunCount}`}
            accent="text-emerald-700"
          />
        </div>

        {!loading && adaptiveRunCount === 0 && (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            Complete and stop at least one adaptive simulation to build analytics history.
          </div>
        )}

        {adaptiveRunCount > 0 && (
          <>
            <div className="grid gap-4 xl:grid-cols-3">
              <MetricCard
                label="Latest Adaptive Run"
                value={latestRun?.run_id || 'N/A'}
                detail={latestRun ? `${formatScenario(latestRun.scenario)} | ${formatDateTime(latestRun.ended_at || latestRun.ran_at || latestRun.started_at)}` : 'No adaptive run stored yet'}
              />
              <PeriodBadgeList title="Peak Traffic Hours" items={summary?.peak_traffic_hours || []} />
              <PeriodBadgeList title="Low Volume Periods" items={summary?.low_volume_periods || []} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <TrendChart
                title="Average Wait Time Trend"
                data={trendRows}
                dataKey="avg_wait_time"
                formatter={(value) => `${Number(value || 0).toFixed(1)}s`}
                stroke="#22c55e"
              />
              <TrendChart
                title="Throughput Trend"
                data={trendRows}
                dataKey="throughput_per_min"
                formatter={(value) => `${Number(value || 0).toFixed(1)}`}
                stroke="#f97316"
              />
              <TrendChart
                title="Queue Length Trend"
                data={trendRows}
                dataKey="avg_queue_length"
                formatter={(value) => `${Number(value || 0).toFixed(1)}`}
                stroke="#0f172a"
              />
              <TrendChart
                title="Spillback Trend"
                data={trendRows}
                dataKey="spillback_events"
                formatter={(value) => `${Number(value || 0).toFixed(1)}`}
                stroke="#ef4444"
              />
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                Stored Adaptive Run History
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-3 pr-4 font-semibold">Simulation No.</th>
                      <th className="pb-3 pr-4 font-semibold">Recorded At</th>
                      <th className="pb-3 pr-4 font-semibold">Scenario</th>
                      <th className="pb-3 pr-4 font-semibold">Avg Wait Time</th>
                      <th className="pb-3 pr-4 font-semibold">Throughput</th>
                      <th className="pb-3 pr-4 font-semibold">Emergency Preemption</th>
                      <th className="pb-3 pr-4 font-semibold">Queue Length</th>
                      <th className="pb-3 pr-4 font-semibold">Spillback</th>
                      <th className="pb-3 font-semibold">Green Wave</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    {historyRows.map((run, index) => (
                      <tr key={run.run_id || `${run.recorded_at}-${index}`} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-semibold">{adaptiveRunCount - index}</td>
                        <td className="py-3 pr-4">{formatDateTime(run.recorded_at)}</td>
                        <td className="py-3 pr-4">{formatScenario(run.scenario)}</td>
                        <td className="py-3 pr-4">{Number(run.avg_wait_time || 0).toFixed(1)}s</td>
                        <td className="py-3 pr-4">{Number(run.throughput_per_min || 0).toFixed(1)} veh/min</td>
                        <td className="py-3 pr-4">{Number(run.preemption_events || 0).toFixed(0)}</td>
                        <td className="py-3 pr-4">{Number(run.avg_queue_length || 0).toFixed(1)}</td>
                        <td className="py-3 pr-4">{Number(run.spillback_events || 0).toFixed(0)}</td>
                        <td className="py-3">{Number(run.green_wave_success_rate || 0).toFixed(1)}%</td>
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
