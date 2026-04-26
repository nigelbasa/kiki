import React, { useCallback, useEffect, useState } from 'react';
import { get, post } from '@shared/api/client';
import Spinner from '@shared/components/Spinner';

const SLIDERS = [
  // Signal Timing
  { section: 'Signal Timing', key: 'MIN_GREEN', label: 'Min green duration', min: 5, max: 30, step: 1, suffix: 's' },
  { section: 'Signal Timing', key: 'MAX_GREEN', label: 'Max green duration', min: 30, max: 120, step: 1, suffix: 's' },
  { section: 'Signal Timing', key: 'AMBER_DURATION', label: 'Amber duration', min: 2, max: 6, step: 1, suffix: 's' },

  // Traffic Generation
  { section: 'Traffic Generation', key: 'OFFPEAK_ARRIVAL_RATE', label: 'Off-peak arrival rate', min: 0.05, max: 0.3, step: 0.01, suffix: '' },
  { section: 'Traffic Generation', key: 'PEAK_ARRIVAL_RATE', label: 'Peak arrival rate', min: 0.2, max: 0.8, step: 0.01, suffix: '' },

  // System
  { section: 'System', key: 'TICK_RATE_HZ', label: 'Simulation speed', min: 0.5, max: 5.0, step: 0.1, suffix: ' ticks/sec' },
  { section: 'System', key: 'SPILLBACK_THRESHOLD', label: 'Spillback threshold', min: 5, max: 30, step: 1, suffix: ' vehicles' },
  { section: 'Emergency Priority', key: 'PREEMPTION_HOLD_SECONDS', label: 'Ambulance reserved green', min: 4, max: 30, step: 1, suffix: 's' },
];

const BACKEND_KEY_MAP = {
  MIN_GREEN: 'min_green',
  MAX_GREEN: 'max_green',
  AMBER_DURATION: 'amber_duration',
  SPILLBACK_THRESHOLD: 'spillback_threshold',
  TICK_RATE_HZ: 'tick_rate_hz',
  PEAK_ARRIVAL_RATE: 'peak_arrival_rate',
  OFFPEAK_ARRIVAL_RATE: 'offpeak_arrival_rate',
  PREEMPTION_HOLD_SECONDS: 'preemption_hold_seconds',
};

function Section({ title, children }) {
  return (
    <fieldset className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <legend className="px-2 text-sm font-semibold uppercase text-gray-500">{title}</legend>
      <div className="space-y-3 pt-2">{children}</div>
    </fieldset>
  );
}

function Slider({ spec, value, onChange }) {
  const formatted = spec.step < 1 ? Number(value).toFixed(2) : String(value);
  return (
    <div className="grid grid-cols-[1fr_160px_100px] items-center gap-3">
      <label className="text-sm text-gray-700">{spec.label}</label>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(spec.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
        className="accent-rwendo-accent"
      />
      <div className="text-right text-sm font-medium tabular-nums text-gray-800">
        {formatted}
        <span className="text-gray-500">{spec.suffix}</span>
      </div>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const bg = toast.kind === 'error' ? 'bg-signal-red' : 'bg-signal-green';
  return (
    <div className={`fixed right-6 top-6 z-50 rounded-md px-4 py-2 text-sm font-medium text-white shadow-lg ${bg}`}>
      {toast.message}
    </div>
  );
}

export default function SettingsPage() {
  const [values, setValues] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await get('/api/simulation/config');
      const picked = {};
      SLIDERS.forEach((s) => {
        if (s.key in cfg) picked[s.key] = cfg[s.key];
      });
      setValues(picked);
      setLoaded(true);
    } catch (e) {
      setToast({ kind: 'error', message: 'Failed to load config' });
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleChange(key, v) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function apply() {
    const payload = {};
    for (const [k, v] of Object.entries(values)) {
      const apiKey = BACKEND_KEY_MAP[k];
      if (apiKey) payload[apiKey] = v;
    }
    try {
      const response = await post('/api/simulation/config', payload);
      if (response?.applied) {
        const picked = {};
        SLIDERS.forEach((s) => {
          if (s.key in response.applied) picked[s.key] = response.applied[s.key];
        });
        setValues(picked);
      }
      setToast({ kind: 'success', message: 'Settings applied' });
    } catch (e) {
      console.error(e);
      setToast({ kind: 'error', message: 'Failed to apply - see console' });
    }
  }

  const sections = Array.from(new Set(SLIDERS.map((s) => s.section)));

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gray-50 p-6">
      <Toast toast={toast} />
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-800">System Settings</h1>
        <p className="text-sm text-gray-500">
          Tune adaptive timing, traffic generation, and emergency behavior. Changes apply on the next simulation tick.
        </p>
      </div>

      {!loaded ? (
        <div className="mt-6 flex items-center gap-3 text-sm text-gray-500">
          <Spinner size="sm" />
          Loading current config...
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {sections.map((section) => (
            <Section key={section} title={section}>
              {SLIDERS.filter((s) => s.section === section).map((s) => (
                <Slider
                  key={s.key}
                  spec={s}
                  value={values[s.key] ?? s.min}
                  onChange={(v) => handleChange(s.key, v)}
                />
              ))}
            </Section>
          ))}

          <div className="flex gap-3 pt-2">
            <button
              onClick={apply}
              className="rounded-md bg-rwendo-accent px-6 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Apply Settings
            </button>
            <button
              onClick={loadConfig}
              className="rounded-md border border-gray-300 bg-white px-6 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Reload Current Values
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
