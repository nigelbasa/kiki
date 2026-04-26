import { useEffect, useState, useCallback } from 'react';
import { useSocket } from './useSocket';
import { get } from '@shared/api/client';

export function useSimulation() {
  const { socket, connected } = useSocket();
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    get('/api/simulation/state')
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {});

    const handler = (data) => setState(data);
    socket.on('simulation:tick', handler);
    return () => {
      cancelled = true;
      socket.off('simulation:tick', handler);
    };
  }, [socket]);

  const sendCommand = useCallback(
    (action, extras = {}) => {
      socket.emit('simulation:command', { action, ...extras });
    },
    [socket],
  );

  const sendPreempt = useCallback(
    (intersection_id, approach) => {
      socket.emit('simulation:preempt', { intersection_id, approach });
    },
    [socket],
  );

  return { state, sendCommand, sendPreempt, connected };
}
