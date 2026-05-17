import React from 'react';

let _cached = null;

/**
 * Cheap one-shot probe: tries to create a throwaway WebGL2/WebGL1 context on
 * an off-DOM canvas. Returns { ok: true } or { ok: false, reason } and caches
 * the result so we don't burn a context per call. WebGL contexts are a scarce
 * resource — some browsers cap at ~8 concurrent contexts.
 */
export function probeWebGL() {
  if (_cached) return _cached;
  if (typeof document === 'undefined') {
    _cached = { ok: false, reason: 'no-document' };
    return _cached;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: false });
    if (!gl) {
      _cached = { ok: false, reason: 'no-context' };
      return _cached;
    }
    // Some browsers hand back a context object that immediately reports lost.
    if (gl.isContextLost && gl.isContextLost()) {
      _cached = { ok: false, reason: 'context-lost-on-create' };
      return _cached;
    }
    _cached = { ok: true };
    return _cached;
  } catch (error) {
    _cached = { ok: false, reason: error?.message || 'exception' };
    return _cached;
  }
}

export function WebGLUnavailableNotice({ reason, onRetry }) {
  return (
    <div className="w-full rounded-[24px] border border-amber-200 bg-amber-50 p-6 text-amber-900">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">3D View Unavailable</div>
          <div className="mt-1 text-lg font-bold">Your browser couldn’t initialise WebGL on this machine.</div>
          <div className="mt-1 text-sm">
            The rest of the dashboard (controls, junction metrics, agent activity, run history, analytics, reports)
            still works — only the live 3D map is affected.
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="self-start rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 lg:self-auto"
          >
            Retry 3D View
          </button>
        )}
      </div>

      <div className="mt-4 rounded-[16px] border border-amber-200 bg-white p-4 text-sm">
        <div className="font-semibold text-amber-900">Try these in order:</div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-800">
          <li>
            In Chrome / Edge: open <code className="rounded bg-amber-100 px-1">chrome://settings/system</code> →
            enable <em>“Use hardware acceleration when available”</em> → relaunch the browser.
          </li>
          <li>
            Check <code className="rounded bg-amber-100 px-1">chrome://gpu</code>. The “WebGL” row should read
            <em> Hardware accelerated</em>. If it’s <em>Software only</em>, your GPU is on the browser blocklist —
            update the GPU driver or try a different browser (Firefox often works when Chrome doesn’t).
          </li>
          <li>
            If you’re inside a Remote Desktop / VM / WSL session, run the dashboard in a browser on the host instead
            — WebGL is usually disabled in remote sessions.
          </li>
          <li>
            Close other tabs that use WebGL (Maps, Figma, games). Browsers cap WebGL contexts; once you’re over the
            limit, new ones fail to create.
          </li>
        </ol>
        {reason && (
          <div className="mt-3 text-xs text-amber-700">
            Diagnostic detail: <code className="rounded bg-amber-100 px-1">{String(reason)}</code>
          </div>
        )}
      </div>
    </div>
  );
}
