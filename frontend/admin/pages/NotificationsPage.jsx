import { useCallback, useEffect, useState } from 'react';
import { get, post } from '@shared/api/client';
import { useSocket } from '@shared/hooks/useSocket';

const LEVEL_STYLES = {
  info: 'border-l-slate-400',
  warning: 'border-l-signal-amber',
  critical: 'border-l-signal-red',
};

export default function NotificationsPage({ user }) {
  const { socket, connected } = useSocket();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const isAdmin = user?.role === 'admin';

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts(await get('/api/simulation/alerts'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    const onAlert = (alert) => {
      setAlerts((current) => {
        const exists = current.some(
          (entry) => entry.timestamp === alert.timestamp && entry.message === alert.message,
        );
        if (exists) return current;
        return [alert, ...current].slice(0, 50);
      });
      setLoading(false);
    };

    socket.on('simulation:alert', onAlert);
    return () => {
      socket.off('simulation:alert', onAlert);
    };
  }, [socket]);

  async function clearAlerts() {
    if (!isAdmin) return;
    setBusy(true);
    try {
      await post('/api/simulation/alerts/clear', {});
      setAlerts([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Notifications</h1>
            <p className="mt-2 text-sm text-slate-500">
              Adaptive-run operational alerts for spillback, congestion risk, and emergency response.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {connected ? 'Live socket connected' : 'Socket offline, using periodic refresh'}
            </p>
          </div>
          <div className="flex gap-3">
            {isAdmin && (
              <button
                onClick={clearAlerts}
                disabled={busy}
                className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          {loading ? (
            <div className="text-sm text-slate-500">Loading notifications...</div>
          ) : alerts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-slate-500">
              No adaptive-run notifications recorded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert, index) => (
                <div
                  key={`${alert.timestamp}-${index}`}
                  className={`rounded-2xl border-l-4 bg-slate-50 px-5 py-4 ${LEVEL_STYLES[alert.level] || LEVEL_STYLES.info}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {alert.category || alert.level}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {alert.title || 'Traffic Alert'}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">{new Date(alert.timestamp).toLocaleString()}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-700">{alert.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
