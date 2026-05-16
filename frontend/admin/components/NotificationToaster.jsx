import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@shared/hooks/useSocket';

const LEVEL_STYLES = {
  info: 'border-slate-300 bg-white text-slate-800',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  critical: 'border-rose-300 bg-rose-50 text-rose-900',
};

const DISMISS_AFTER_MS = 6000;

export default function NotificationToaster() {
  const { socket } = useSocket();
  const [toasts, setToasts] = useState([]);
  const timeoutsRef = useRef(new Map());

  useEffect(() => {
    const onAlert = (alert) => {
      const id = `${alert.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => [...current.slice(-4), { ...alert, id }]);
      const timeout = window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
      timeoutsRef.current.set(id, timeout);
    };
    socket.on('simulation:alert', onAlert);
    return () => {
      socket.off('simulation:alert', onAlert);
    };
  }, [socket]);

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      timeouts.clear();
    };
  }, []);

  function dismiss(id) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timeout = timeoutsRef.current.get(id);
    if (timeout) {
      window.clearTimeout(timeout);
      timeoutsRef.current.delete(id);
    }
  }

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-50 flex w-[min(360px,calc(100vw-3rem))] flex-col gap-3">
      {toasts.map((toast) => {
        const tone = LEVEL_STYLES[toast.level] || LEVEL_STYLES.info;
        return (
          <button
            type="button"
            key={toast.id}
            onClick={() => dismiss(toast.id)}
            className={`pointer-events-auto rounded-[18px] border-l-4 px-4 py-3 text-left shadow-lg transition hover:scale-[1.01] ${tone}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
                {toast.category || toast.level}
              </div>
              <div className="text-[10px] opacity-60">{toast.timestamp ? new Date(toast.timestamp).toLocaleTimeString() : ''}</div>
            </div>
            <div className="mt-1 text-sm font-bold">{toast.title || 'Traffic Alert'}</div>
            <div className="mt-1 text-sm opacity-90">{toast.message}</div>
          </button>
        );
      })}
    </div>
  );
}
