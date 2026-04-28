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

function StatCard({ title, value, detail, accent = 'text-slate-900' }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className={`mt-3 text-2xl font-bold ${accent}`}>{value}</div>
      {detail && <div className="mt-2 text-sm text-slate-500">{detail}</div>}
    </div>
  );
}

function ReportChart({ title, data, lines }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            {lines.map((line) => (
              <Line key={line.key} type="monotone" dataKey={line.key} stroke={line.stroke} strokeWidth={3} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
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

  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
            <p className="mt-2 text-sm text-slate-500">
              Generate downloadable network reports with overall and per-junction traffic summaries.
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
                  </div>
                  <a
                    href={api.fileUrl(`/api/analytics/reports/${selectedReport.report_id}/download`)}
                    className="rounded-full border border-rwendo-accent px-5 py-2 text-sm font-semibold text-rwendo-accent transition hover:bg-rwendo-accent hover:text-white"
                  >
                    Download Report
                  </a>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <StatCard
                    title="Average Delay"
                    value={`${Number(selectedReport.network?.average_delay || 0).toFixed(1)}s`}
                    detail="Overall network average delay on vehicles"
                    accent="text-emerald-700"
                  />
                  <StatCard
                    title="Congestion Increase"
                    value={Number(selectedReport.network?.congestion_increase || 0).toFixed(1)}
                    detail="Change in congestion across the covered period"
                  />
                  <StatCard
                    title="Peak Traffic Times"
                    value={(selectedReport.network?.peak_traffic_times || []).join(', ') || 'N/A'}
                    detail="Highest-activity periods across the overall network"
                    accent="text-rwendo-accent"
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <ReportChart
                    title="Delay And Congestion Trend"
                    data={selectedReport.trends || []}
                    lines={[
                      { key: 'delay', stroke: '#f97316' },
                      { key: 'congestion', stroke: '#22c55e' },
                    ]}
                  />

                  <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Junction Average Traffic
                    </div>
                    <div className="h-72">
                      <ResponsiveContainer>
                        <BarChart data={selectedReport.junctions || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="id" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} />
                          <Tooltip />
                          <Bar dataKey="average_traffic" fill="#f97316" radius={[8, 8, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Per Junction Summary
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="pb-3 pr-4 font-semibold">Junction</th>
                          <th className="pb-3 pr-4 font-semibold">Average Traffic</th>
                          <th className="pb-3 pr-4 font-semibold">Peak Hours</th>
                          <th className="pb-3 pr-4 font-semibold">Average Wait</th>
                          <th className="pb-3 pr-4 font-semibold">Throughput</th>
                          <th className="pb-3 font-semibold">Spillback</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700">
                        {(selectedReport.junctions || []).map((row) => (
                          <tr key={row.id} className="border-b border-slate-100">
                            <td className="py-3 pr-4 font-semibold">{row.id}</td>
                            <td className="py-3 pr-4">{Number(row.average_traffic || 0).toFixed(1)}</td>
                            <td className="py-3 pr-4">{(row.peak_hours || []).join(', ') || 'N/A'}</td>
                            <td className="py-3 pr-4">{Number(row.average_wait || 0).toFixed(1)}s</td>
                            <td className="py-3 pr-4">{Number(row.average_throughput || 0).toFixed(1)} veh/min</td>
                            <td className="py-3">{Number(row.spillback_events || 0).toFixed(1)}</td>
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
