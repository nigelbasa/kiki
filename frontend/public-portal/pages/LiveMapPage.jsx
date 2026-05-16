import React, { useEffect, useMemo, useState } from 'react';
import { get } from '@shared/api/client';
import { useSimulation } from '@shared/hooks/useSimulation';

// 4-junction rectangle. Corners in SVG space (560 × 440 viewBox).
const NODE_POS = {
  TL_00: { x: 140, y: 100 }, // NW
  TL_01: { x: 420, y: 100 }, // NE
  TL_10: { x: 140, y: 320 }, // SW
  TL_11: { x: 420, y: 320 }, // SE
};

const ROAD_PATHS = {
  'TL_00->TL_01': 'M140 100 L420 100', // top perimeter
  'TL_01->TL_11': 'M420 100 L420 320', // right perimeter
  'TL_10->TL_11': 'M140 320 L420 320', // bottom perimeter
  'TL_00->TL_10': 'M140 100 L140 320', // left perimeter
  // External stubs (drawn separately to keep the rectangle reading clearly).
  externalStubs: [
    'M140 100 L140 40',  // NW north
    'M140 100 L60 100',  // NW west
    'M420 100 L420 40',  // NE north
    'M420 100 L500 100', // NE east
    'M140 320 L140 400', // SW south
    'M140 320 L60 320',  // SW west
    'M420 320 L420 400', // SE south
    'M420 320 L500 320', // SE east
  ],
};

const SEGMENT_META = {
  'TL_00->TL_01': { label: 'Top perimeter — NW to NE', short: 'NW -> NE' },
  'TL_01->TL_11': { label: 'Right perimeter — NE to SE', short: 'NE -> SE' },
  'TL_10->TL_11': { label: 'Bottom perimeter — SW to SE', short: 'SW -> SE' },
  'TL_00->TL_10': { label: 'Left perimeter — NW to SW', short: 'NW -> SW' },
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
  { key: 'TL_00:NS', x: 156, y: 40,  align: 'start', label: 'NW · North' },
  { key: 'TL_00:EW', x: 78,  y: 116, align: 'end',   label: 'NW · West'  },
  { key: 'TL_01:NS', x: 436, y: 40,  align: 'start', label: 'NE · North' },
  { key: 'TL_01:EW', x: 506, y: 116, align: 'start', label: 'NE · East'  },
  { key: 'TL_10:NS', x: 156, y: 416, align: 'start', label: 'SW · South' },
  { key: 'TL_10:EW', x: 78,  y: 336, align: 'end',   label: 'SW · West'  },
  { key: 'TL_11:NS', x: 436, y: 416, align: 'start', label: 'SE · South' },
  { key: 'TL_11:EW', x: 506, y: 336, align: 'start', label: 'SE · East'  },
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
  const meta = (id) => SEGMENT_META[id]?.short || id;
  const suggestions = busy.map((segment) => ({
    title: `${meta(segment.id)} is building up`,
    body: 'Consider taking the opposite side of the rectangle to avoid this corridor.',
  }));

  if (alerts.some((alert) => alert.level === 'critical')) {
    suggestions.unshift({
      title: 'Emergency movement active',
      body: 'Expect short holds around the affected corner while signals recover.',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      title: 'Primary routes are open',
      body: 'All four perimeter corridors are moving normally right now.',
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

                {/* External stubs — neutral grey, drawn first so the perimeter overlays them. */}
                {ROAD_PATHS.externalStubs.map((d, index) => (
                  <g key={`stub-${index}`}>
                    <path d={d} className="fill-none stroke-[#5b4a3a]" strokeWidth="28" strokeLinecap="round" />
                    <path d={d} className="fill-none stroke-[#475569]" strokeWidth="22" strokeLinecap="round" />
                  </g>
                ))}

                {segments.map((segment) => {
                  const path = ROAD_PATHS[segment.id];
                  const meta = SEGMENT_META[segment.id];
                  if (!path) return null;
                  // Label position: midpoint of the path with a small offset.
                  const labelPos = {
                    'TL_00->TL_01': { x: 280, y: 84 },
                    'TL_01->TL_11': { x: 436, y: 210 },
                    'TL_10->TL_11': { x: 280, y: 340 },
                    'TL_00->TL_10': { x: 110, y: 210 },
                  }[segment.id] || { x: 280, y: 220 };
                  return (
                    <g key={segment.id}>
                      <path d={path} className="fill-none stroke-[#5b4a3a]" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" />
                      <path d={path} className="fill-none stroke-[#334155]" strokeWidth="25" strokeLinecap="round" strokeLinejoin="round" />
                      <path d={path} className={`fill-none ${SEGMENT_STROKE[segment.congestion_level]}`} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
                      <text x={labelPos.x} y={labelPos.y} className="fill-slate-900 text-[11px] font-semibold">
                        {meta?.short ?? segment.id}
                      </text>
                      <text x={labelPos.x} y={labelPos.y + 16} className="fill-slate-500 text-[10px]">
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
