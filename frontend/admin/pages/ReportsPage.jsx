import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@shared/api/client';

const PERIOD_OPTIONS = [
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'all', label: 'All Runs' },
];

function formatDateTime(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function formatScenario(value) {
  if (value === 'off_peak') return 'Off-Peak';
  if (value === 'peak') return 'Peak';
  return String(value || '').replace('_', ' ');
}

function StatCard({ title, value, detail, accent = 'text-slate-900' }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className={`mt-3 text-2xl font-bold ${accent}`}>{value}</div>
      {detail && <div className="mt-2 text-sm text-slate-500">{detail}</div>}
    </div>
  );
}

function TrendChart({ title, data, lines, formatter }) {
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
            {lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                stroke={line.stroke}
                strokeWidth={3}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function isoWeekKey(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function bucketRuns(runs, bucketKey) {
  const map = new Map();
  for (const run of runs) {
    const recorded = run.recorded_at ? new Date(run.recorded_at) : null;
    if (!recorded || Number.isNaN(recorded.getTime())) continue;
    const key = bucketKey(recorded);
    if (!map.has(key)) {
      map.set(key, { key, runs: 0, wait: 0, throughput: 0, queue: 0, preemptions: 0, spillback: 0 });
    }
    const entry = map.get(key);
    entry.runs += 1;
    entry.wait += Number(run.avg_wait_time || 0);
    entry.throughput += Number(run.throughput_per_min || 0);
    entry.queue += Number(run.avg_queue_length || 0);
    entry.preemptions += Number(run.preemption_events || 0);
    entry.spillback += Number(run.spillback_events || 0);
  }
  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      avgWait: entry.runs ? entry.wait / entry.runs : 0,
      avgThroughput: entry.runs ? entry.throughput / entry.runs : 0,
      avgQueue: entry.runs ? entry.queue / entry.runs : 0,
    }))
    .sort((a, b) => (a.key > b.key ? 1 : -1));
}

function SegmentTable({ title, rows, labelHeader }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      {rows.length === 0 ? (
        <div className="mt-4 rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center text-sm text-slate-500">
          No runs in this segmentation yet.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-4 font-semibold">{labelHeader}</th>
                <th className="py-2 pr-4 font-semibold">Runs</th>
                <th className="py-2 pr-4 font-semibold">Avg wait</th>
                <th className="py-2 pr-4 font-semibold">Avg throughput</th>
                <th className="py-2 pr-4 font-semibold">Avg queue</th>
                <th className="py-2 pr-4 font-semibold">Preemptions</th>
                <th className="py-2 font-semibold">Spillback</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-semibold">{row.key}</td>
                  <td className="py-2 pr-4">{row.runs}</td>
                  <td className="py-2 pr-4">{row.avgWait.toFixed(1)}s</td>
                  <td className="py-2 pr-4">{row.avgThroughput.toFixed(1)} veh/min</td>
                  <td className="py-2 pr-4">{row.avgQueue.toFixed(1)}</td>
                  <td className="py-2 pr-4">{row.preemptions.toFixed(0)}</td>
                  <td className="py-2">{row.spillback.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SectionHeading({ eyebrow, title, hint }) {
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rwendo-accent">{eyebrow}</div>
      <div className="mt-1 text-lg font-bold text-slate-900">{title}</div>
      {hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

function PeakHourChart({ runs }) {
  const hourly = bucketRuns(runs, (date) => `${String(date.getHours()).padStart(2, '0')}:00`);
  const fullDay = Array.from({ length: 24 }, (_, hour) => {
    const key = `${String(hour).padStart(2, '0')}:00`;
    const match = hourly.find((entry) => entry.key === key);
    return {
      hour: key,
      throughput: match ? match.avgThroughput : 0,
      runs: match ? match.runs : 0,
    };
  });

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Peak Hour Traffic Distribution</div>
      <div className="mt-4 h-64">
        <ResponsiveContainer>
          <BarChart data={fullDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={1} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value || 0).toFixed(1)} />
            <Tooltip formatter={(value) => `${Number(value || 0).toFixed(1)} veh/min`} />
            <Bar dataKey="throughput" fill="#f97316" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BadgeList({ title, items }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(items || []).length ? (
          items.map((item) => (
            <span
              key={item}
              className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
            >
              {item}
            </span>
          ))
        ) : (
          <span className="text-sm text-slate-500">No stored adaptive history in this period.</span>
        )}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [periodLabel, setPeriodLabel] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/api/analytics/reports');
      setReports(result);
      setSelectedReportId((current) => current || result[0]?.report_id || '');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const selectedReport = useMemo(() => {
    return reports.find((report) => report.report_id === selectedReportId) || reports[0] || null;
  }, [reports, selectedReportId]);

  async function generateReport() {
    setGenerating(true);
    try {
      const report = await api.post(`/api/analytics/reports/generate?period_label=${encodeURIComponent(periodLabel)}`, {});
      setReports((current) => [report, ...current.filter((entry) => entry.report_id !== report.report_id)]);
      setSelectedReportId(report.report_id);
    } finally {
      setGenerating(false);
    }
  }

  const network = selectedReport?.network || {};
  const trends = selectedReport?.trends || [];
  const runs = selectedReport?.runs || [];

  const dailyRows = useMemo(
    () => bucketRuns(runs, (date) => date.toISOString().slice(0, 10)),
    [runs],
  );
  const weeklyRows = useMemo(() => bucketRuns(runs, isoWeekKey), [runs]);
  const monthlyRows = useMemo(
    () => bucketRuns(runs, (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`),
    [runs],
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
            <p className="mt-2 text-sm text-slate-500">
              Operational summaries for traffic monitoring — generated from completed adaptive runs. Downloads are PDF.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={periodLabel}
              onChange={(event) => setPeriodLabel(event.target.value)}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={generateReport}
              disabled={generating}
              className="rounded-full bg-rwendo-accent px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {generating ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Saved Reports</div>
            {loading ? (
              <div className="mt-4 text-sm text-slate-500">Loading reports...</div>
            ) : reports.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                No reports generated yet.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {reports.map((report) => {
                  const active = report.report_id === selectedReport?.report_id;
                  return (
                    <button
                      key={report.report_id}
                      type="button"
                      onClick={() => setSelectedReportId(report.report_id)}
                      className={`w-full rounded-[18px] border px-4 py-3 text-left transition ${
                        active ? 'border-rwendo-accent bg-rwendo-accent/5' : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-900">{report.report_id}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(report.generated_at)}</div>
                      <div className="mt-2 text-xs uppercase tracking-[0.12em] text-slate-400">
                        {report.period?.label || 'report'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-6">
            {!selectedReport ? (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
                Select a report to preview it here.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Report Overview</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900">{selectedReport.report_id}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      Generated {formatDateTime(selectedReport.generated_at)}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      Covers {formatDateTime(selectedReport.period?.start)} to {formatDateTime(selectedReport.period?.end)}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      Adaptive runs analyzed: {Number(network.runs_analyzed || 0)}
                    </div>
                  </div>
                  <a
                    href={api.fileUrl(`/api/analytics/reports/${selectedReport.report_id}/download`)}
                    download={`rwendo-report-${selectedReport.report_id}.pdf`}
                    className="inline-flex items-center gap-2 rounded-full bg-rwendo-accent px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download PDF
                  </a>
                </div>

                <SectionHeading
                  eyebrow="Summary"
                  title="Network-wide adaptive averages"
                  hint="Aggregates across every adaptive run in the selected period."
                />
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <StatCard
                    title="Average Wait Time"
                    value={`${Number(network.average_wait_time || 0).toFixed(1)}s`}
                    detail="Average across adaptive runs in this report"
                    accent="text-emerald-700"
                  />
                  <StatCard
                    title="Average Throughput"
                    value={`${Number(network.average_throughput || 0).toFixed(1)} veh/min`}
                    detail="Average adaptive throughput"
                    accent="text-rwendo-accent"
                  />
                  <StatCard
                    title="Average Queue Length"
                    value={Number(network.average_queue_length || 0).toFixed(1)}
                    detail="Average queued vehicles across the network"
                  />
                  <StatCard
                    title="Spillback Frequency"
                    value={Number(network.average_spillback_frequency || 0).toFixed(1)}
                    detail="Average spillback events per run"
                  />
                  <StatCard
                    title="Emergency Preemptions"
                    value={Number(network.average_emergency_preemptions || 0).toFixed(1)}
                    detail="Average preemption events per run"
                  />
                  <StatCard
                    title="Green Wave Success"
                    value={`${Number(network.average_green_wave_success_rate || 0).toFixed(1)}%`}
                    detail="Average green-wave success rate"
                    accent="text-emerald-700"
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <BadgeList title="Peak Traffic Times" items={network.peak_traffic_times || []} />
                  <BadgeList title="Low Volume Periods" items={network.low_volume_periods || []} />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <TrendChart
                    title="Wait And Queue Trend"
                    data={trends}
                    lines={[
                      { key: 'avg_wait_time', stroke: '#22c55e' },
                      { key: 'avg_queue_length', stroke: '#0f172a' },
                    ]}
                    formatter={(value) => Number(value || 0).toFixed(1)}
                  />
                  <TrendChart
                    title="Throughput And Spillback Trend"
                    data={trends}
                    lines={[
                      { key: 'throughput_per_min', stroke: '#f97316' },
                      { key: 'spillback_events', stroke: '#ef4444' },
                    ]}
                    formatter={(value) => Number(value || 0).toFixed(1)}
                  />
                </div>

                <SectionHeading
                  eyebrow="Time segmentation"
                  title="Volume and performance over time"
                  hint="Daily, weekly, and monthly aggregates plus a 24-hour peak distribution."
                />
                <PeakHourChart runs={runs} />

                <SegmentTable title="Daily Traffic Volume" labelHeader="Date" rows={dailyRows} />
                <SegmentTable title="Weekly Traffic Trends" labelHeader="ISO Week" rows={weeklyRows} />
                <SegmentTable title="Monthly Traffic Trends" labelHeader="Month" rows={monthlyRows} />

                <SectionHeading
                  eyebrow="Run history"
                  title="Stored adaptive runs in this period"
                  hint="Each row is one completed adaptive simulation persisted to the analytics store."
                />

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Stored Adaptive Runs
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="pb-3 pr-4 font-semibold">Run ID</th>
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
                        {runs.map((run) => (
                          <tr key={`${run.run_id}-${run.recorded_at}`} className="border-b border-slate-100">
                            <td className="py-3 pr-4 font-semibold">{run.run_id}</td>
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
      </div>
    </div>
  );
}
