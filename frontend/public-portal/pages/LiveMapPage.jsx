import React, { useEffect, useMemo, useState } from 'react';
import { get } from '@shared/api/client';
import { useSimulation } from '@shared/hooks/useSimulation';

const NODE_POS = {
  TL_00: { x: 118, y: 116 },
  TL_10: { x: 118, y: 320 },
  TL_11: { x: 430, y: 320 },
};

const ROAD_PATHS = {
  'TL_00->TL_10': 'M118 42 L118 392',
  'TL_10->TL_11': 'M42 320 L512 320',
  'TL_00->TL_11': 'M44 116 L118 116 L430 320',
  tl11South: 'M430 320 L430 392',
};

const SEGMENT_META = {
  'TL_00->TL_10': { label: 'Julius Nyerere southbound', short: 'TL_00 to TL_10' },
  'TL_10->TL_11': { label: 'Borrowdale eastbound', short: 'TL_10 to TL_11' },
  'TL_00->TL_11': { label: 'Samora diagonal', short: 'TL_00 to TL_11' },
};

const SEGMENT_STROKE = {
  clear: 'stroke-emerald-400',
  moderate: 'stroke-amber-400',
  heavy: 'stroke-rose-400',
};

const CARD_TONE = {
  clear: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  moderate: 'bg-amber-50 text-amber-900 ring-amber-200',
  heavy: 'bg-rose-50 text-rose-900 ring-rose-200',
};

const PHASE_COLOR = {
  red: 'fill-rose-500',
  amber: 'fill-amber-400',
  green: 'fill-emerald-500',
};

const OUTER_APPROACH_LABELS = [
  { key: 'TL_00:NS', x: 136, y: 70, align: 'start', label: 'North approach' },
  { key: 'TL_00:EW', x: 66, y: 134, align: 'end', label: 'West approach' },
  { key: 'TL_10:NS', x: 136, y: 378, align: 'start', label: 'South approach' },
  { key: 'TL_10:EW', x: 66, y: 338, align: 'end', label: 'West approach' },
  { key: 'TL_11:EW', x: 494, y: 302, align: 'start', label: 'East approach' },
  { key: 'TL_11:NS', x: 448, y: 378, align: 'start', label: 'South approach' },
];

function SignalIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="8" y="2" width="8" height="20" rx="3" fill="currentColor" />
      <circle cx="12" cy="7" r="2" fill="#f87171" />
      <circle cx="12" cy="12" r="2" fill="#fb923c" />
      <circle cx="12" cy="17" r="2" fill="#4ade80" />
    </svg>
  );
}

function phaseForIntersection(intersection) {
  if (!intersection?.approaches?.length) return 'red';
  if (intersection.approaches.some((entry) => entry.phase === 'amber')) return 'amber';
  if (intersection.approaches.some((entry) => entry.phase === 'green')) return 'green';
  return 'red';
}

function severityFromLevel(level) {
  if (level === 'critical') return 'Critical';
  if (level === 'warning') return 'Watch';
  return 'Info';
}

function buildRouteSuggestions(segments, alerts) {
  const busy = segments.filter((segment) => segment.congestion_level !== 'clear');
  const suggestions = busy.map((segment) => {
    if (segment.id === 'TL_00->TL_11') {
      return {
        title: 'Diagonal is slower',
        body: 'Use TL_00 -> TL_10 -> TL_11 until the Samora connector clears.',
      };
    }
    if (segment.id === 'TL_10->TL_11') {
      return {
        title: 'Bottom corridor is building up',
        body: 'If you are still near TL_00, use the diagonal to reach TL_11.',
      };
    }
    return {
      title: 'Southbound pressure at TL_00',
      body: 'Delay the TL_00 -> TL_10 movement or approach through TL_11 first if possible.',
    };
  });

  if (alerts.some((alert) => alert.level === 'critical')) {
    suggestions.unshift({
      title: 'Emergency movement active',
      body: 'Expect short holds around the affected junction while signals recover.',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      title: 'Primary routes are open',
      body: 'All three visible corridors are moving normally right now.',
    });
  }

  return suggestions.slice(0, 3);
}

function approachQueueMap(intersections) {
  const map = {};
  intersections.forEach((intersection) => {
    (intersection.approaches || []).forEach((approach) => {
      map[`${intersection.id}:${approach.direction}`] = approach.queue_length || 0;
    });
  });
  return map;
}

export default function LiveMapPage({ user, onLogout, onOpenProfile }) {
  const { state, connected } = useSimulation();
  const [alertFeed, setAlertFeed] = useState([]);

  useEffect(() => {
    let cancelled = false;
    get('/api/simulation/alerts')
      .then((rows) => {
        if (!cancelled) setAlertFeed(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state?.alerts?.length]);

  const segments = state?.segments ?? [];
  const intersections = state?.intersections ?? [];

  const busiestSegment = useMemo(
    () => [...segments].sort((a, b) => b.vehicles_in_transit - a.vehicles_in_transit)[0] ?? null,
    [segments],
  );

  const routeSuggestions = useMemo(
    () => buildRouteSuggestions(segments, alertFeed),
    [segments, alertFeed],
  );

  const approachLoads = useMemo(() => approachQueueMap(intersections), [intersections]);

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-slate-700">
        <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-5 text-sm shadow-sm">
          Connecting to the live Rwendo traffic feed...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <header className="rounded-[30px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3 text-rwendo-accent">
                <SignalIcon className="h-6 w-6" />
                <span className="text-xs font-semibold uppercase tracking-[0.28em]">Rwendo Public Traffic</span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Live road status
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Congestion, route guidance, and public alerts from the active junction network.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
                {user?.display_name ?? 'Public user'}
              </div>
              <div className={`rounded-full px-4 py-2 text-sm font-medium ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                {connected ? 'Live feed connected' : 'Waiting for feed'}
              </div>
              <button
                type="button"
                onClick={onOpenProfile}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Profile
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-full border border-rwendo-accent px-4 py-2 text-sm font-medium text-rwendo-accent transition hover:bg-rwendo-accent hover:text-white"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Network mode</div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{state.current_mode}</div>
            <div className="mt-2 text-sm text-slate-500">{state.running ? 'Signals are active' : 'Simulation is paused'}</div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Live vehicles</div>
            <div className="mt-3 text-3xl font-bold text-slate-900">
              {segments.reduce((total, segment) => total + segment.vehicles_in_transit, 0)}
            </div>
            <div className="mt-2 text-sm text-slate-500">Vehicles currently on the main corridors.</div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Public alerts</div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{alertFeed.length}</div>
            <div className="mt-2 text-sm text-slate-500">Spillback and emergency advisories.</div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Busiest corridor</div>
            <div className="mt-3 text-xl font-bold text-slate-900">
              {busiestSegment ? (SEGMENT_META[busiestSegment.id]?.label ?? busiestSegment.id) : 'No active load'}
            </div>
            <div className="mt-2 text-sm text-slate-500">
              {busiestSegment ? `${busiestSegment.vehicles_in_transit} vehicles in transit` : 'Traffic is currently light.'}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[30px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4 px-2">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Live map</div>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Network overview</h2>
              </div>
              <div className="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-600">
                Tick {state.tick} • {state.scenario.replace('_', ' ')}
              </div>
            </div>

            <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] p-3">
              <svg viewBox="0 0 560 440" className="h-auto w-full">
                <rect x="0" y="0" width="560" height="440" rx="28" className="fill-[#edf2f7]" />

                <path d={ROAD_PATHS.tl11South} className="fill-none stroke-[#5b4a3a]" strokeWidth="30" strokeLinecap="round" />
                <path d={ROAD_PATHS.tl11South} className="fill-none stroke-[#334155]" strokeWidth="24" strokeLinecap="round" />
                <path d={ROAD_PATHS.tl11South} className="fill-none stroke-[#fbbf24]" strokeWidth="1.8" strokeLinecap="round" />

                {segments.map((segment) => {
                  const path = ROAD_PATHS[segment.id];
                  const meta = SEGMENT_META[segment.id];
                  if (!path) return null;
                  const textX = segment.id === 'TL_00->TL_10' ? 142 : segment.id === 'TL_10->TL_11' ? 260 : 250;
                  const textY = segment.id === 'TL_00->TL_10' ? 214 : segment.id === 'TL_10->TL_11' ? 344 : 188;
                  return (
                    <g key={segment.id}>
                      <path d={path} className="fill-none stroke-[#5b4a3a]" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" />
                      <path d={path} className="fill-none stroke-[#334155]" strokeWidth="25" strokeLinecap="round" strokeLinejoin="round" />
                      <path d={path} className={`fill-none ${SEGMENT_STROKE[segment.congestion_level]}`} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
                      <text x={textX} y={textY} className="fill-slate-900 text-[11px] font-semibold">
                        {meta?.short ?? segment.id}
                      </text>
                      <text x={textX} y={textY + 16} className="fill-slate-500 text-[10px]">
                        {segment.vehicles_in_transit} vehicles
                      </text>
                    </g>
                  );
                })}

                {OUTER_APPROACH_LABELS.map((item) => (
                  <g key={item.key}>
                    <rect
                      x={item.align === 'end' ? item.x - 82 : item.x - 4}
                      y={item.y - 18}
                      width="86"
                      height="26"
                      rx="13"
                      className="fill-white stroke-slate-200"
                    />
                    <text x={item.x} y={item.y - 7} textAnchor={item.align} className="fill-slate-900 text-[10px] font-semibold">
                      {item.label}
                    </text>
                    <text x={item.x} y={item.y + 5} textAnchor={item.align} className="fill-rwendo-accent text-[10px] font-semibold">
                      {approachLoads[item.key] ?? 0} queued
                    </text>
                  </g>
                ))}

                {intersections.map((intersection) => {
                  const pos = NODE_POS[intersection.id];
                  if (!pos) return null;
                  return (
                    <g key={intersection.id}>
                      <circle cx={pos.x} cy={pos.y} r="26" className="fill-slate-900 stroke-white" strokeWidth="2" />
                      <circle cx={pos.x} cy={pos.y} r="18" className={PHASE_COLOR[phaseForIntersection(intersection)]} />
                      <text x={pos.x} y={pos.y + 52} textAnchor="middle" className="fill-slate-900 text-[12px] font-semibold">
                        {intersection.id}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Route guidance</div>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Suggested alternatives</h2>
              <div className="mt-4 space-y-3">
                {routeSuggestions.map((route, index) => (
                  <div key={`${route.title}-${index}`} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-base font-semibold text-slate-900">{route.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{route.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Corridor pressure</div>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Current road load</h2>
              <div className="mt-4 space-y-3">
                {segments.map((segment) => {
                  const meta = SEGMENT_META[segment.id];
                  return (
                    <div key={segment.id} className={`rounded-[20px] p-4 ring-1 ${CARD_TONE[segment.congestion_level]}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-semibold">{meta?.label ?? segment.id}</div>
                          <div className="mt-1 text-sm opacity-80">{meta?.short}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold uppercase">{segment.congestion_level}</div>
                          <div className="mt-1 text-xs">{segment.vehicles_in_transit} vehicles</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Alerts and notifications</div>
          <h2 className="mt-1 text-xl font-bold text-slate-900">What commuters should know</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {alertFeed.length === 0 ? (
              <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                No active public advisories. The visible network is moving normally.
              </div>
            ) : (
              alertFeed.slice(0, 6).map((alert, index) => (
                <div key={`${alert.timestamp}-${index}`} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">{severityFromLevel(alert.level)}</div>
                    <div className="text-xs text-slate-500">{new Date(alert.timestamp).toLocaleTimeString()}</div>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{alert.message}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
